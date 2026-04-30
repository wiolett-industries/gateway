package enrollment

import (
	"context"
	"crypto/tls"
	"fmt"
	"time"

	pb "github.com/wiolett-industries/gateway/daemon-shared/gatewayv1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

// Enroll performs the initial enrollment with a PSK token.
// Uses TOFU (trust on first use) for the server certificate.
func Enroll(address, token, hostname, nginxVersion, osInfo, daemonVersion, daemonType string) (*pb.EnrollResponse, error) {
	// TOFU: accept any server cert during enrollment
	tlsCfg := &tls.Config{
		InsecureSkipVerify: true,
	}

	conn, err := grpc.NewClient(address,
		grpc.WithTransportCredentials(credentials.NewTLS(tlsCfg)),
	)
	if err != nil {
		return nil, fmt.Errorf("dial gateway: %w", err)
	}
	defer conn.Close()

	client := pb.NewNodeEnrollmentClient(conn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resp, err := client.Enroll(ctx, &pb.EnrollRequest{
		Token:         token,
		Hostname:      hostname,
		NginxVersion:  nginxVersion,
		OsInfo:        osInfo,
		DaemonVersion: daemonVersion,
		DaemonType:    daemonType,
	})
	if err != nil {
		return nil, fmt.Errorf("enrollment failed: %w", err)
	}

	return resp, nil
}
