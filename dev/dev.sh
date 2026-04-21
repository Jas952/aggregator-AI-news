#!/bin/bash

# Dev Environment Management Script
# Uses separate Docker Compose project: tst_site_dev

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

case "$1" in
    start)
        echo "Starting DEV environment (project: tst_site_dev) on port 8002..."
        docker compose -f "$SCRIPT_DIR/docker-compose.dev.yml" up -d
        echo ""
        echo "✓ Dev environment started!"
        echo "  Dev site: http://localhost:8002"
        echo "  Dev RSS:  http://localhost:8003"
        echo ""
        echo "Containers:"
        docker compose -f "$SCRIPT_DIR/docker-compose.dev.yml" ps
        ;;

    stop)
        echo "Stopping DEV environment..."
        docker compose -f "$SCRIPT_DIR/docker-compose.dev.yml" down
        ;;

    restart)
        echo "Restarting DEV environment..."
        docker compose -f "$SCRIPT_DIR/docker-compose.dev.yml" restart
        ;;

    logs)
        docker compose -f "$SCRIPT_DIR/docker-compose.dev.yml" logs -f app
        ;;

    update)
        echo "Updating DEV container with index.dev.html..."
        docker compose -f "$SCRIPT_DIR/docker-compose.dev.yml" cp "$SCRIPT_DIR/index.dev.html" app:/app/index.html
        echo "✓ Dev files updated!"
        ;;

    promote)
        echo "Promoting DEV changes to PRODUCTION..."
        echo "  1. Copying dev/index.dev.html → index.html"
        cp "$SCRIPT_DIR/index.dev.html" "$PROJECT_ROOT/index.html"
        echo "  2. Updating Production container..."
        cd "$PROJECT_ROOT" && docker compose cp index.html app:/app/index.html
        echo ""
        echo "✓ Changes promoted to Production!"
        echo "  Check: https://aishny.space"
        ;;

    status)
        echo "=== DEV Environment Status ==="
        docker compose -f "$SCRIPT_DIR/docker-compose.dev.yml" ps
        echo ""
        echo "=== PRODUCTION Environment Status ==="
        cd "$PROJECT_ROOT" && docker compose ps
        ;;

    shell)
        echo "Opening shell in DEV container..."
        docker compose -f "$SCRIPT_DIR/docker-compose.dev.yml" exec app /bin/bash
        ;;

    *)
        echo "Usage: ./dev.sh {start|stop|restart|logs|update|promote|status|shell}"
        echo ""
        echo "Commands:"
        echo "  start   - Start dev environment (port 8002)"
        echo "  stop    - Stop dev environment"
        echo "  restart - Restart dev environment"
        echo "  logs    - Show dev logs"
        echo "  update  - Copy index.dev.html to dev container"
        echo "  promote - Promote dev changes to production"
        echo "  status  - Show status of both environments"
        echo "  shell   - Open shell in dev container"
        echo ""
        echo "Workflow:"
        echo "  1. Edit index.dev.html (your dev version)"
        echo "  2. ./dev.sh update (update dev container)"
        echo "  3. Test at http://localhost:8002"
        echo "  4. ./dev.sh promote (copy to production)"
        exit 1
        ;;
esac
