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
		&net.IPNet{IP: net.ParseIP("169.254.20.1"), Mask: net.CIDRMask(16, 32)},
		&net.IPNet{IP: net.ParseIP("fe80::20"), Mask: net.CIDRMask(64, 128)},
		&net.IPNet{IP: net.ParseIP("fd00::10"), Mask: net.CIDRMask(64, 128)},
	}

	got := normalizeLocalIPAddresses(addresses)
	want := []string{"192.168.1.20", "10.0.0.8", "fd00::10"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestIsLocalAddressInterface(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{name: "eth0", want: true},
		{name: "ens18", want: true},
		{name: "br0", want: true},
		{name: "vmbr0", want: true},
		{name: "wg0", want: true},
		{name: "tailscale0", want: true},
		{name: "br-production", want: true},
		{name: "docker0", want: false},
		{name: "docker_gwbridge", want: false},
		{name: "br-06f5bebc02fd", want: false},
		{name: "BR-ABCDEF012345", want: false},
		{name: "veth7721c0a", want: false},
		{name: "cni0", want: false},
		{name: "cali123456", want: false},
		{name: "flannel.1", want: false},
		{name: "kube-ipvs0", want: false},
		{name: "weave", want: false},
		{name: "virbr0", want: false},
		{name: "lxcbr0", want: false},
		{name: "lxdbr0", want: false},
		{name: "podman0", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isLocalAddressInterface(test.name); got != test.want {
				t.Fatalf("expected %t, got %t", test.want, got)
			}
		})
	}
}

func TestClassifyInterfaceIPAddresses(t *testing.T) {
	local, public := classifyInterfaceIPAddresses([]string{
		"172.16.20.61",
		"fd00::10",
		"100.64.10.2",
		"1.1.1.1",
		"2001:4860:4860::8888",
	})

	if !reflect.DeepEqual(local, []string{"172.16.20.61", "fd00::10", "100.64.10.2"}) {
		t.Fatalf("unexpected local addresses: %v", local)
	}
	if !reflect.DeepEqual(public, []string{"1.1.1.1", "2001:4860:4860::8888"}) {
		t.Fatalf("unexpected public addresses: %v", public)
	}
}
