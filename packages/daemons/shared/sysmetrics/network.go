package sysmetrics

import (
	"bufio"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"

	pb "github.com/wiolett-industries/gateway/daemon-shared/gatewayv1"
)

// GetNetworkInterfaces reads /proc/net/dev and returns per-interface stats, skipping lo.
func GetNetworkInterfaces() []*pb.NetworkInterface {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil
	}

	var ifaces []*pb.NetworkInterface

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	lineNum := 0
	for scanner.Scan() {
		lineNum++
		// Skip the first two header lines
		if lineNum <= 2 {
			continue
		}
		line := scanner.Text()
		// Format: "  iface: rx_bytes rx_packets rx_errs rx_drop ... tx_bytes tx_packets tx_errs tx_drop ..."
		colonIdx := strings.Index(line, ":")
		if colonIdx < 0 {
			continue
		}
		name := strings.TrimSpace(line[:colonIdx])
		if name == "lo" {
			continue
		}

		rest := strings.TrimSpace(line[colonIdx+1:])
		fields := strings.Fields(rest)
		if len(fields) < 16 {
			continue
		}

		rxBytes, _ := strconv.ParseInt(fields[0], 10, 64)
		rxPackets, _ := strconv.ParseInt(fields[1], 10, 64)
		rxErrors, _ := strconv.ParseInt(fields[2], 10, 64)
		txBytes, _ := strconv.ParseInt(fields[8], 10, 64)
		txPackets, _ := strconv.ParseInt(fields[9], 10, 64)
		txErrors, _ := strconv.ParseInt(fields[10], 10, 64)

		ifaces = append(ifaces, &pb.NetworkInterface{
			Name:      name,
			RxBytes:   rxBytes,
			TxBytes:   txBytes,
			RxPackets: rxPackets,
			TxPackets: txPackets,
			RxErrors:  rxErrors,
			TxErrors:  txErrors,
		})
	}

	return ifaces
}

// GetLocalIPAddresses returns the usable addresses assigned to active,
// non-loopback interfaces. CIDR prefixes are intentionally omitted because
// the Gateway displays these as node identities rather than route definitions.
func GetLocalIPAddresses() []string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}

	var addresses []net.Addr
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		interfaceAddresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		addresses = append(addresses, interfaceAddresses...)
	}

	return normalizeLocalIPAddresses(addresses)
}

func normalizeLocalIPAddresses(addresses []net.Addr) []string {
	unique := make(map[string]struct{}, len(addresses))
	for _, address := range addresses {
		var ip net.IP
		switch value := address.(type) {
		case *net.IPNet:
			ip = value.IP
		case *net.IPAddr:
			ip = value.IP
		default:
			parsedIP, _, err := net.ParseCIDR(address.String())
			if err == nil {
				ip = parsedIP
			} else {
				ip = net.ParseIP(address.String())
			}
		}

		if ip == nil || ip.IsLoopback() || ip.IsUnspecified() {
			continue
		}
		unique[ip.String()] = struct{}{}
	}

	result := make([]string, 0, len(unique))
	for address := range unique {
		result = append(result, address)
	}
	sort.Strings(result)
	return result
}
