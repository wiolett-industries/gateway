package sysmetrics

import (
	"net"
	"reflect"
	"testing"
)

func TestNormalizeLocalIPAddresses(t *testing.T) {
	addresses := []net.Addr{
		&net.IPNet{IP: net.ParseIP("192.168.1.20"), Mask: net.CIDRMask(24, 32)},
		&net.IPNet{IP: net.ParseIP("10.0.0.8"), Mask: net.CIDRMask(8, 32)},
		&net.IPNet{IP: net.ParseIP("192.168.1.20"), Mask: net.CIDRMask(24, 32)},
		&net.IPNet{IP: net.ParseIP("127.0.0.1"), Mask: net.CIDRMask(8, 32)},
		&net.IPNet{IP: net.IPv4zero, Mask: net.CIDRMask(0, 32)},
		&net.IPNet{IP: net.ParseIP("fd00::10"), Mask: net.CIDRMask(64, 128)},
	}

	got := normalizeLocalIPAddresses(addresses)
	want := []string{"192.168.1.20", "10.0.0.8", "fd00::10"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}
