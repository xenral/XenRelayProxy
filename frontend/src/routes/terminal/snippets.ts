export const snippet = {
  sh(path: string, httpAddr: string, socksAddr: string): string {
    const cert = path || "/path/to/ca.crt";
    const lines = [
      `export NODE_EXTRA_CA_CERTS="${cert}"`,
      `export SSL_CERT_FILE="${cert}"`,
      `export REQUESTS_CA_BUNDLE="${cert}"`,
      `export PIP_CERT="${cert}"`,
      `export CURL_CA_BUNDLE="${cert}"`,
      `export HTTP_PROXY="http://${httpAddr}"`,
      `export HTTPS_PROXY="http://${httpAddr}"`,
    ];
    if (socksAddr) lines.push(`export ALL_PROXY="socks5h://${socksAddr}"`);
    lines.push(`export NO_PROXY="localhost,127.0.0.1,::1"`);
    return lines.join("\n");
  },

  pwsh(path: string, httpAddr: string): string {
    const cert = path || "C:\\path\\to\\ca.crt";
    return [
      `$env:NODE_EXTRA_CA_CERTS = "${cert}"`,
      `$env:SSL_CERT_FILE       = "${cert}"`,
      `$env:REQUESTS_CA_BUNDLE  = "${cert}"`,
      `$env:PIP_CERT            = "${cert}"`,
      `$env:CURL_CA_BUNDLE      = "${cert}"`,
      `$env:HTTP_PROXY          = "http://${httpAddr}"`,
      `$env:HTTPS_PROXY         = "http://${httpAddr}"`,
      `$env:NO_PROXY            = "localhost,127.0.0.1"`,
    ].join("\n");
  },

  cmdSession(path: string, httpAddr: string): string {
    const cert = path || "C:\\path\\to\\ca.crt";
    return [
      `set NODE_EXTRA_CA_CERTS=${cert}`,
      `set SSL_CERT_FILE=${cert}`,
      `set REQUESTS_CA_BUNDLE=${cert}`,
      `set PIP_CERT=${cert}`,
      `set CURL_CA_BUNDLE=${cert}`,
      `set HTTP_PROXY=http://${httpAddr}`,
      `set HTTPS_PROXY=http://${httpAddr}`,
      `set NO_PROXY=localhost,127.0.0.1`,
    ].join("\n");
  },

  cmdPersist(path: string, httpAddr: string): string {
    const cert = path || "C:\\path\\to\\ca.crt";
    return [
      `setx NODE_EXTRA_CA_CERTS "${cert}"`,
      `setx SSL_CERT_FILE       "${cert}"`,
      `setx REQUESTS_CA_BUNDLE  "${cert}"`,
      `setx PIP_CERT            "${cert}"`,
      `setx CURL_CA_BUNDLE      "${cert}"`,
      `setx HTTP_PROXY          "http://${httpAddr}"`,
      `setx HTTPS_PROXY         "http://${httpAddr}"`,
    ].join("\n");
  },
};
