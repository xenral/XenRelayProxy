export namespace config {
	
	export class Account {
	    label: string;
	    email?: string;
	    script_id?: string;
	    script_ids?: string[];
	    account_type: string;
	    enabled: boolean;
	    weight: number;
	    daily_quota: number;
	
	    static createFrom(source: any = {}) {
	        return new Account(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.email = source["email"];
	        this.script_id = source["script_id"];
	        this.script_ids = source["script_ids"];
	        this.account_type = source["account_type"];
	        this.enabled = source["enabled"];
	        this.weight = source["weight"];
	        this.daily_quota = source["daily_quota"];
	    }
	}
	export class Scheduler {
	    strategy: string;
	    cooloff_seconds: number;
	    throttle_backoff_seconds: number;
	    quota_safety_margin: number;
	    state_file: string;
	    state_persist_interval_seconds: number;
	    keepalive_interval_seconds: number;
	    prewarm_on_start: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Scheduler(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.strategy = source["strategy"];
	        this.cooloff_seconds = source["cooloff_seconds"];
	        this.throttle_backoff_seconds = source["throttle_backoff_seconds"];
	        this.quota_safety_margin = source["quota_safety_margin"];
	        this.state_file = source["state_file"];
	        this.state_persist_interval_seconds = source["state_persist_interval_seconds"];
	        this.keepalive_interval_seconds = source["keepalive_interval_seconds"];
	        this.prewarm_on_start = source["prewarm_on_start"];
	    }
	}
	export class Config {
	    mode: string;
	    google_ip: string;
	    front_domain: string;
	    front_domains?: string[];
	    auth_key: string;
	    script_id?: string;
	    script_ids?: string[];
	    accounts: Account[];
	    scheduler: Scheduler;
	    listen_host: string;
	    listen_port: number;
	    socks5_enabled: boolean;
	    socks5_port: number;
	    log_level: string;
	    verify_ssl: boolean;
	    lan_sharing: boolean;
	    relay_timeout: number;
	    tls_connect_timeout: number;
	    tcp_connect_timeout: number;
	    max_request_body_bytes: number;
	    max_response_body_bytes: number;
	    chunked_download_min_size: number;
	    chunked_download_chunk_size: number;
	    chunked_download_max_parallel: number;
	    chunked_download_max_chunks: number;
	    chunked_download_extensions: string[];
	    cache_max_bytes: number;
	    metrics_max_hosts: number;
	    bypass_hosts: string[];
	    direct_google_exclude: string[];
	    direct_google_allow: string[];
	    sni_rewrite_hosts: string[];
	    force_relay_sni_hosts: boolean;
	    inject_permissive_cors: boolean;
	    cookie_debug_mode: boolean;
	    cookie_critical_hosts: string[];
	    direct_tunnel_hosts: string[];
	    block_long_poll_paths: string[];
	    block_hosts: string[];
	    hosts: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.google_ip = source["google_ip"];
	        this.front_domain = source["front_domain"];
	        this.front_domains = source["front_domains"];
	        this.auth_key = source["auth_key"];
	        this.script_id = source["script_id"];
	        this.script_ids = source["script_ids"];
	        this.accounts = this.convertValues(source["accounts"], Account);
	        this.scheduler = this.convertValues(source["scheduler"], Scheduler);
	        this.listen_host = source["listen_host"];
	        this.listen_port = source["listen_port"];
	        this.socks5_enabled = source["socks5_enabled"];
	        this.socks5_port = source["socks5_port"];
	        this.log_level = source["log_level"];
	        this.verify_ssl = source["verify_ssl"];
	        this.lan_sharing = source["lan_sharing"];
	        this.relay_timeout = source["relay_timeout"];
	        this.tls_connect_timeout = source["tls_connect_timeout"];
	        this.tcp_connect_timeout = source["tcp_connect_timeout"];
	        this.max_request_body_bytes = source["max_request_body_bytes"];
	        this.max_response_body_bytes = source["max_response_body_bytes"];
	        this.chunked_download_min_size = source["chunked_download_min_size"];
	        this.chunked_download_chunk_size = source["chunked_download_chunk_size"];
	        this.chunked_download_max_parallel = source["chunked_download_max_parallel"];
	        this.chunked_download_max_chunks = source["chunked_download_max_chunks"];
	        this.chunked_download_extensions = source["chunked_download_extensions"];
	        this.cache_max_bytes = source["cache_max_bytes"];
	        this.metrics_max_hosts = source["metrics_max_hosts"];
	        this.bypass_hosts = source["bypass_hosts"];
	        this.direct_google_exclude = source["direct_google_exclude"];
	        this.direct_google_allow = source["direct_google_allow"];
	        this.sni_rewrite_hosts = source["sni_rewrite_hosts"];
	        this.force_relay_sni_hosts = source["force_relay_sni_hosts"];
	        this.inject_permissive_cors = source["inject_permissive_cors"];
	        this.cookie_debug_mode = source["cookie_debug_mode"];
	        this.cookie_critical_hosts = source["cookie_critical_hosts"];
	        this.direct_tunnel_hosts = source["direct_tunnel_hosts"];
	        this.block_long_poll_paths = source["block_long_poll_paths"];
	        this.block_hosts = source["block_hosts"];
	        this.hosts = source["hosts"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace frontscan {
	
	export class Result {
	    ip: string;
	    rtt_ms: number;
	    ok: boolean;
	    error?: string;
	    recommend: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ip = source["ip"];
	        this.rtt_ms = source["rtt_ms"];
	        this.ok = source["ok"];
	        this.error = source["error"];
	        this.recommend = source["recommend"];
	    }
	}

}

export namespace obs {
	
	export class Entry {
	    time: string;
	    level: string;
	    message: string;
	    source?: string;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.level = source["level"];
	        this.message = source["message"];
	        this.source = source["source"];
	    }
	}
	export class HostSnapshot {
	    host: string;
	    requests: number;
	    errors: number;
	    avg_latency_ms: number;
	
	    static createFrom(source: any = {}) {
	        return new HostSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.requests = source["requests"];
	        this.errors = source["errors"];
	        this.avg_latency_ms = source["avg_latency_ms"];
	    }
	}
	export class Snapshot {
	    started_at: string;
	    total_requests: number;
	    total_errors: number;
	    bytes_up: number;
	    bytes_down: number;
	    last_latency_ms: number;
	    hosts: HostSnapshot[];
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.started_at = source["started_at"];
	        this.total_requests = source["total_requests"];
	        this.total_errors = source["total_errors"];
	        this.bytes_up = source["bytes_up"];
	        this.bytes_down = source["bytes_down"];
	        this.last_latency_ms = source["last_latency_ms"];
	        this.hosts = this.convertValues(source["hosts"], HostSnapshot);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace relayvpn {
	
	export class CACertInfo {
	    cert_path: string;
	    fingerprint: string;
	    subject: string;
	    not_before: string;
	    not_after: string;
	    exists: boolean;
	    trusted: boolean;
	    pem: string;
	
	    static createFrom(source: any = {}) {
	        return new CACertInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cert_path = source["cert_path"];
	        this.fingerprint = source["fingerprint"];
	        this.subject = source["subject"];
	        this.not_before = source["not_before"];
	        this.not_after = source["not_after"];
	        this.exists = source["exists"];
	        this.trusted = source["trusted"];
	        this.pem = source["pem"];
	    }
	}
	export class Status {
	    state: string;
	    running: boolean;
	    config_path: string;
	    listen_address: string;
	    socks5_address: string;
	    active_account?: string;
	    ca_trusted: boolean;
	    last_error?: string;
	    started_at?: string;
	    version: string;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = source["state"];
	        this.running = source["running"];
	        this.config_path = source["config_path"];
	        this.listen_address = source["listen_address"];
	        this.socks5_address = source["socks5_address"];
	        this.active_account = source["active_account"];
	        this.ca_trusted = source["ca_trusted"];
	        this.last_error = source["last_error"];
	        this.started_at = source["started_at"];
	        this.version = source["version"];
	    }
	}
	export class Stats {
	    status: Status;
	    metrics: obs.Snapshot;
	    scheduler: scheduler.Stats;
	    logs: obs.Entry[];
	
	    static createFrom(source: any = {}) {
	        return new Stats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = this.convertValues(source["status"], Status);
	        this.metrics = this.convertValues(source["metrics"], obs.Snapshot);
	        this.scheduler = this.convertValues(source["scheduler"], scheduler.Stats);
	        this.logs = this.convertValues(source["logs"], obs.Entry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace scheduler {
	
	export class AccountStats {
	    label: string;
	    enabled: boolean;
	    account_type: string;
	    deployments: number;
	    calls_today: number;
	    daily_quota: number;
	    percent_used: number;
	    cooloff_remaining_seconds: number;
	    consecutive_errors: number;
	    is_warm: boolean;
	    total_calls: number;
	    total_errors: number;
	    weight: number;
	
	    static createFrom(source: any = {}) {
	        return new AccountStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.enabled = source["enabled"];
	        this.account_type = source["account_type"];
	        this.deployments = source["deployments"];
	        this.calls_today = source["calls_today"];
	        this.daily_quota = source["daily_quota"];
	        this.percent_used = source["percent_used"];
	        this.cooloff_remaining_seconds = source["cooloff_remaining_seconds"];
	        this.consecutive_errors = source["consecutive_errors"];
	        this.is_warm = source["is_warm"];
	        this.total_calls = source["total_calls"];
	        this.total_errors = source["total_errors"];
	        this.weight = source["weight"];
	    }
	}
	export class Stats {
	    strategy: string;
	    total_daily_quota: number;
	    total_calls_today: number;
	    accounts: AccountStats[];
	
	    static createFrom(source: any = {}) {
	        return new Stats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.strategy = source["strategy"];
	        this.total_daily_quota = source["total_daily_quota"];
	        this.total_calls_today = source["total_calls_today"];
	        this.accounts = this.convertValues(source["accounts"], AccountStats);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

