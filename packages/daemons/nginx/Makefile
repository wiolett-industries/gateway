MODULE := github.com/wiolett/gateway/nginx-daemon
PROTO_DIR := ../../../proto
OUT_DIR := internal/gatewayv1
BINARY := bin/nginx-daemon

.PHONY: all build test lint clean proto

all: proto build

proto:
	@mkdir -p $(OUT_DIR)
	protoc \
		--proto_path=$(PROTO_DIR) \
		--go_out=. \
		--go_opt=module=$(MODULE) \
		--go-grpc_out=. \
		--go-grpc_opt=module=$(MODULE) \
		gateway/v1/nginx-daemon.proto

build:
	CGO_ENABLED=0 go build -o $(BINARY) ./cmd/nginx-daemon

test:
	go test ./...

lint:
	go vet ./...

clean:
	rm -rf bin/
