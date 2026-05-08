package obs

import (
	"sync"
	"sync/atomic"
	"time"
)

type DownloadStatus string

const (
	DownloadActive    DownloadStatus = "active"
	DownloadDone      DownloadStatus = "done"
	DownloadFailed    DownloadStatus = "failed"
	DownloadCancelled DownloadStatus = "cancelled"
)

type DownloadEntry struct {
	ID         string         `json:"id"`
	URL        string         `json:"url"`
	Filename   string         `json:"filename"`
	TotalBytes int64          `json:"total_bytes"`
	DoneBytes  int64          `json:"done_bytes"`
	Chunks     int            `json:"chunks"`
	DoneChunks int            `json:"done_chunks"`
	Status     DownloadStatus `json:"status"`
	Error      string         `json:"error,omitempty"`
	StartedAt  string         `json:"started_at"`
	BytesPerSec int64         `json:"bytes_per_sec"`
}

type activeDownload struct {
	id         string
	url        string
	filename   string
	total      int64
	done       atomic.Int64
	chunks     int
	doneChunks atomic.Int32
	status     DownloadStatus
	errMsg     string
	startedAt  time.Time
	cancel     func() // optional; invoked by Cancel to abort in-flight chunk fetches
}

type Downloads struct {
	mu      sync.Mutex
	active  map[string]*activeDownload
	seq     int64
}

func NewDownloads() *Downloads {
	return &Downloads{active: make(map[string]*activeDownload)}
}

func (d *Downloads) Start(id, rawURL, filename string, totalBytes int64, chunks int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.active[id] = &activeDownload{
		id:        id,
		url:       rawURL,
		filename:  filename,
		total:     totalBytes,
		chunks:    chunks,
		status:    DownloadActive,
		startedAt: time.Now(),
	}
}

func (d *Downloads) AddBytes(id string, n int64) {
	d.mu.Lock()
	dl, ok := d.active[id]
	d.mu.Unlock()
	if ok {
		dl.done.Add(n)
	}
}

func (d *Downloads) ChunkDone(id string) {
	d.mu.Lock()
	dl, ok := d.active[id]
	d.mu.Unlock()
	if ok {
		dl.doneChunks.Add(1)
	}
}

func (d *Downloads) Finish(id string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if dl, ok := d.active[id]; ok {
		dl.status = DownloadDone
		dl.done.Store(dl.total)
	}
}

func (d *Downloads) Fail(id string, err string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if dl, ok := d.active[id]; ok {
		dl.status = DownloadFailed
		dl.errMsg = err
	}
}

func (d *Downloads) Remove(id string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.active, id)
}

// SetCancel registers a cancel function that will be called when Cancel
// is invoked for this download. Called once after Start.
func (d *Downloads) SetCancel(id string, fn func()) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if dl, ok := d.active[id]; ok {
		dl.cancel = fn
	}
}

// Cancel marks the download cancelled and invokes its registered cancel
// function (if any) to abort in-flight chunk fetches. Returns true when
// the download was active and got cancelled, false when not found or
// already finished.
func (d *Downloads) Cancel(id string) bool {
	d.mu.Lock()
	dl, ok := d.active[id]
	if !ok || dl.status != DownloadActive {
		d.mu.Unlock()
		return false
	}
	dl.status = DownloadCancelled
	dl.errMsg = "cancelled"
	cancel := dl.cancel
	d.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return true
}

func (d *Downloads) NextID() string {
	d.mu.Lock()
	d.seq++
	id := d.seq
	d.mu.Unlock()
	return "dl-" + itoa(id)
}

func (d *Downloads) Snapshot() []DownloadEntry {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]DownloadEntry, 0, len(d.active))
	for _, dl := range d.active {
		doneBytes := dl.done.Load()
		elapsed := time.Since(dl.startedAt).Seconds()
		var bps int64
		if elapsed > 0.5 {
			bps = int64(float64(doneBytes) / elapsed)
		}
		out = append(out, DownloadEntry{
			ID:          dl.id,
			URL:         dl.url,
			Filename:    dl.filename,
			TotalBytes:  dl.total,
			DoneBytes:   doneBytes,
			Chunks:      dl.chunks,
			DoneChunks:  int(dl.doneChunks.Load()),
			Status:      dl.status,
			Error:       dl.errMsg,
			StartedAt:   dl.startedAt.Format(time.RFC3339),
			BytesPerSec: bps,
		})
	}
	return out
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf) - 1
	for n > 0 {
		buf[i] = byte('0' + n%10)
		n /= 10
		i--
	}
	return string(buf[i+1:])
}
