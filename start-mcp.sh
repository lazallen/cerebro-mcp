#!/bin/bash

# Cerebro MCP Server Startup Script
# This script ensures the MCP server starts reliably and handles restarts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
PID_FILE="$SCRIPT_DIR/.mcp-server.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Function to check if server is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Function to stop the server
stop_server() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo -e "${YELLOW}Stopping MCP server (PID: $PID)...${NC}"
            kill "$PID"

            # Wait for graceful shutdown
            for i in {1..10}; do
                if ! ps -p "$PID" > /dev/null 2>&1; then
                    break
                fi
                sleep 0.5
            done

            # Force kill if still running
            if ps -p "$PID" > /dev/null 2>&1; then
                echo -e "${YELLOW}Force stopping server...${NC}"
                kill -9 "$PID"
            fi

            rm -f "$PID_FILE"
            echo -e "${GREEN}Server stopped${NC}"
        else
            rm -f "$PID_FILE"
        fi
    fi
}

# Function to start the server
start_server() {

    # Application (client) ID from Azure Portal
    echo -e "${GREEN}Getting secrets from 1Password${NC}"
    export MICROSOFT_CLIENT_ID=$(op read --account skyscanner.1password.eu "op://Employee/Outlook Client/client-id")

    # Client secret VALUE (not the secret ID) from Azure Portal > Certificates & secrets
    export MICROSOFT_CLIENT_SECRET=$(op read --account skyscanner.1password.eu "op://Employee/Outlook Client/client-secret")

    # Directory (tenant) ID from Azure Portal > Overview
    # Use 'common' for multi-tenant, 'organizations' for any org account, or your specific tenant ID
    export MICROSOFT_TENANT_ID=$(op read --account skyscanner.1password.eu "op://Employee/Outlook Client/tenant-id")

    # Setting up the Slack credentials we need to authenticate.
    export SLACK_CLIENT_ID=$(op read --account skyscanner.1password.eu "op://Employee/Slack Credentials/client-id")
    export SLACK_CLIENT_SECRET=$(op read --account skyscanner.1password.eu "op://Employee/Slack Credentials/client-secret")
    echo -e "${GREEN}Starting Cerebro MCP server...${NC}"

    cd "$SCRIPT_DIR"

    # Check if build exists
    if [ ! -f "dist/index.js" ]; then
        echo -e "${YELLOW}Building project...${NC}"
        npm run build
    fi

    # Start the server
    nohup node dist/index.js > "$LOG_DIR/mcp-server.log" 2>&1 &
    SERVER_PID=$!
    echo $SERVER_PID > "$PID_FILE"

    # Wait a moment and check if it started successfully
    sleep 2

    if ps -p "$SERVER_PID" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ MCP server started successfully (PID: $SERVER_PID)${NC}"
        echo -e "${GREEN}✓ MCP endpoint: http://localhost:3334/mcp${NC}"
        echo -e "${GREEN}✓ Health check: http://localhost:3334/health${NC}"
        echo -e "${GREEN}✓ OAuth dashboard: https://localhost:3333/${NC}"
        echo -e "${GREEN}✓ Logs: $LOG_DIR/mcp-server.log${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to start server. Check logs at $LOG_DIR/mcp-server.log${NC}"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Function to check server health
check_health() {
    echo -e "${YELLOW}Checking server health...${NC}"

    HEALTH_RESPONSE=$(curl -s http://localhost:3334/health 2>&1)
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Server is healthy${NC}"
        echo "$HEALTH_RESPONSE" | jq '.' 2>/dev/null || echo "$HEALTH_RESPONSE"
        return 0
    else
        echo -e "${RED}✗ Server is not responding${NC}"
        return 1
    fi
}

# Main script logic
case "${1:-start}" in
    start)
        if is_running; then
            echo -e "${YELLOW}MCP server is already running${NC}"
            check_health
        else
            start_server
        fi
        ;;

    stop)
        stop_server
        ;;

    restart)
        echo -e "${YELLOW}Restarting MCP server...${NC}"
        stop_server
        sleep 1
        start_server
        ;;

    status)
        if is_running; then
            PID=$(cat "$PID_FILE")
            echo -e "${GREEN}✓ MCP server is running (PID: $PID)${NC}"
            check_health
        else
            echo -e "${RED}✗ MCP server is not running${NC}"
            exit 1
        fi
        ;;

    health)
        check_health
        ;;

    logs)
        if [ -f "$LOG_DIR/mcp-server.log" ]; then
            tail -f "$LOG_DIR/mcp-server.log"
        else
            echo -e "${RED}No logs found at $LOG_DIR/mcp-server.log${NC}"
            exit 1
        fi
        ;;

    *)
        echo "Usage: $0 {start|stop|restart|status|health|logs}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the MCP server"
        echo "  stop    - Stop the MCP server"
        echo "  restart - Restart the MCP server"
        echo "  status  - Check if server is running and show health"
        echo "  health  - Check server health endpoint"
        echo "  logs    - Tail server logs"
        exit 1
        ;;
esac
