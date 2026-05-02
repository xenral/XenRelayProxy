package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"xenrelayproxy/pkg/relayvpn"
)

func main() {
	configPath := flag.String("config", "config.json", "Path to config file")
	flag.Parse()

	api := relayvpn.NewAPI(*configPath)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := api.Start(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "start failed: %v\n", err)
		os.Exit(1)
	}
	status := api.Status()
	fmt.Printf("XenRelayProxy listening on %s", status.ListenAddress)
	if status.SOCKS5Address != "" {
		fmt.Printf(" and SOCKS5 %s", status.SOCKS5Address)
	}
	fmt.Println()
	<-ctx.Done()
	_ = api.Stop()
}
