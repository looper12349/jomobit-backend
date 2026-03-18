#!/bin/bash

echo "🔍 Checking DNS propagation..."
echo ""

DOMAIN="api-dev-jomo.dazzeldigital.com"
EXPECTED="ac0313d2e870f42a9a775e60144d1f3a"
OLD="aa42c7b292285409ba2d300cdb12a265"

# Get current DNS resolution
CURRENT=$(nslookup $DOMAIN 2>/dev/null | grep "canonical name" | awk '{print $5}')

echo "Domain: $DOMAIN"
echo "Current DNS: $CURRENT"
echo ""

# Check which LoadBalancer it points to
if echo "$CURRENT" | grep -q "$EXPECTED"; then
    echo "✅ DNS UPDATED! Points to NEW LoadBalancer"
    echo "   $EXPECTED"
    echo ""
    echo "You can now test:"
    echo "  ./scripts/test-after-dns-update.sh"
elif echo "$CURRENT" | grep -q "$OLD"; then
    echo "⏳ DNS NOT YET PROPAGATED. Still points to OLD LoadBalancer"
    echo "   $OLD"
    echo ""
    echo "Wait a few minutes and run this script again:"
    echo "  ./scripts/check-dns.sh"
else
    echo "❓ Unknown DNS resolution"
    echo ""
    echo "Full nslookup output:"
    nslookup $DOMAIN
fi
