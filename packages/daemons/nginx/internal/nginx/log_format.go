package nginx

import (
	"os"
	"strings"
)

const gatewayLogFormat = `log_format gateway_combined '$remote_addr - $remote_user [$time_local] '
    '"$request" $status $body_bytes_sent '
    '"$http_referer" "$http_user_agent" '
    '$upstream_response_time $request_time';`

// EnsureLogFormat checks if the gateway log format is present in nginx.conf.
// If not, injects it into the http block. Returns true if modified.
func EnsureLogFormat(nginxConfPath string) (bool, error) {
	data, err := os.ReadFile(nginxConfPath)
	if err != nil {
		return false, err
	}

	content := string(data)
	if strings.Contains(content, "gateway_combined") {
		return false, nil // already present
	}

	// Find the http { block and inject after it
	httpIdx := strings.Index(content, "http {")
	if httpIdx == -1 {
		httpIdx = strings.Index(content, "http{")
	}
	if httpIdx == -1 {
		return false, nil // can't find http block
	}

	// Find the opening brace
	braceIdx := strings.Index(content[httpIdx:], "{")
	if braceIdx == -1 {
		return false, nil
	}
	insertAt := httpIdx + braceIdx + 1

	injection := "\n    # Gateway daemon log format (auto-injected)\n    " + gatewayLogFormat + "\n"
	newContent := content[:insertAt] + injection + content[insertAt:]

	return true, WriteAtomic(nginxConfPath, []byte(newContent))
}
