package config

import (
	"crypto/rand"
	"encoding/base64"
)

// GenerateAuthKey returns a cryptographically random 32-byte base64-encoded
// secret suitable for use as the relay auth_key. Format matches the example
// already shipped in apps_script/Code.gs.
func GenerateAuthKey() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}
