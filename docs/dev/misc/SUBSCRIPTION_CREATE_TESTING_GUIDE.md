# Subscription Creation Endpoint Testing Guide

## Quick Start

### Prerequisites
1. MongoDB running
2. Razorpay account with test API keys
3. Environment variables configured:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
4. At least one plan created in database with `razorpayPlanId`

### Test 1: Create Subscription Successfully

```bash
# Get authentication token first
AUTH_TOKEN="your_jwt_token_here"

# Create subscription
curl -X POST http://localhost:3000/api/subscriptions/create \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "pro",
    "totalCount": 1,
    "customerNotify": true
  }'
```

**Expected Response (201):**
```json
{
  "success": true,
  "message": "Subscription created successfully. Please complete payment using the provided URL.",
  "subscription": {
    "_id": "...",
    "razorpaySubscriptionId": "sub_...",
    "short_url": "https://rzp.io/i/...",
    "status": "created",
    "billing": {
      "amount": 5900,
      "currency": "INR",
      "interval": "monthly",
      "intervalCount": 1
    },
    "totalCount": 1,
    "paidCount": 0,
    "remainingCount": 1
  },
  "plan": {
    "name": "Pro",
    "planId": "pro",
    ...
  }
}
```

### Test 2: Missing Plan ID

```bash
curl -X POST http://localhost:3000/api/subscriptions/create \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response (400):**
```json
{
  "success": false,
  "error": "Validation error",
  "message": "Plan ID is required"
}
```

### Test 3: Invalid Plan ID

```bash
curl -X POST http://localhost:3000/api/subscriptions/create \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "nonexistent"
  }'
```

**Expected Response (400):**
```json
{
  "success": false,
  "error": "Plan not found",
  "message": "Invalid plan ID provided"
}
```

### Test 4: Duplicate Subscription

```bash
# First create a subscription (use Test 1)
# Then try to create another one

curl -X POST http://localhost:3000/api/subscriptions/create \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "pro"
  }'
```

**Expected Response (409):**
```json
{
  "success": false,
  "error": "Active subscription exists",
  "message": "User already has an active subscription",
  "subscription": {
    ...existing subscription details...
  }
}
```

### Test 5: Unauthenticated Request

```bash
curl -X POST http://localhost:3000/api/subscriptions/create \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "pro"
  }'
```

**Expected Response (401):**
```json
{
  "success": false,
  "error": "Unauthorized",
  "message": "Authentication required"
}
```

## Integration Testing

### Complete Flow Test

1. **Create Subscription**
   ```bash
   curl -X POST http://localhost:3000/api/subscriptions/create \
     -H "Authorization: Bearer $AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"planId": "pro"}'
   ```

2. **Extract short_url from response**
   ```bash
   # Save the short_url from the response
   SHORT_URL="https://rzp.io/i/abc123"
   ```

3. **Open Payment Page**
   - Open the `short_url` in a browser
   - You should see Razorpay checkout page
   - Use Razorpay test card: 4111 1111 1111 1111
   - CVV: Any 3 digits
   - Expiry: Any future date

4. **Verify Webhooks**
   - After payment, Razorpay sends webhooks
   - Check logs for webhook processing
   - Verify subscription status updated to 'authenticated' then 'active'

5. **Verify Credits Granted**
   ```bash
   curl -X GET http://localhost:3000/api/credits/balance \
     -H "Authorization: Bearer $AUTH_TOKEN"
   ```
   - Should show credits from the plan

## Database Verification

### Check Subscription Created

```javascript
// In MongoDB shell or Compass
db.subscriptions.findOne({
  razorpaySubscriptionId: "sub_..."
})
```

**Expected Fields:**
- `userId`: User's ObjectId
- `planId`: Plan's ObjectId
- `razorpaySubscriptionId`: Razorpay subscription ID
- `razorpayCustomerId`: Razorpay customer ID
- `status`: 'created'
- `billing`: Object with amount, currency, interval
- `shortUrl`: Payment URL
- `totalCount`, `paidCount`, `remainingCount`

### Check Razorpay Customer Created

```javascript
db.subscriptions.findOne({
  userId: ObjectId("...")
}, {
  razorpayCustomerId: 1
})
```

## Razorpay Dashboard Verification

1. Login to Razorpay Dashboard (test mode)
2. Go to Subscriptions section
3. Find the created subscription
4. Verify:
   - Customer details match user
   - Plan matches selected plan
   - Status is 'created'
   - Payment link is active

## Error Scenarios

### Razorpay API Error

If Razorpay API is down or credentials are invalid:

**Expected Response (500):**
```json
{
  "success": false,
  "error": "Razorpay error",
  "message": "Failed to create subscription in Razorpay",
  "details": "API key is invalid"
}
```

### Database Error

If MongoDB is down:

**Expected Response (500):**
```json
{
  "success": false,
  "error": "Internal server error",
  "message": "Failed to create subscription"
}
```

## Performance Testing

### Load Test

```bash
# Install Apache Bench
# Run 100 requests with 10 concurrent
ab -n 100 -c 10 -H "Authorization: Bearer $AUTH_TOKEN" \
   -H "Content-Type: application/json" \
   -p subscription.json \
   http://localhost:3000/api/subscriptions/create
```

**Expected:**
- Response time < 2 seconds
- No errors for valid requests
- Proper error handling for duplicates

## Monitoring

### Check Logs

```bash
# Check application logs
tail -f logs/combined.log | grep "subscription"

# Look for:
# - "Found existing Razorpay customer"
# - "Created new Razorpay customer"
# - "Created Razorpay subscription"
# - "Local subscription created"
```

### Check Metrics

Monitor:
- API response time
- Razorpay API call duration
- Database query time
- Error rate
- Success rate

## Troubleshooting

### Issue: "Plan not found"
**Solution:** Ensure plan exists in database with correct `planId` and has `razorpayPlanId` set

### Issue: "Razorpay error"
**Solution:** 
- Check Razorpay API keys in .env
- Verify Razorpay account is in test mode
- Check Razorpay dashboard for errors

### Issue: "User not found"
**Solution:** 
- Verify JWT token is valid
- Check user exists in database
- Verify Auth0 ID matches

### Issue: "Active subscription exists"
**Solution:** 
- This is expected behavior
- Cancel existing subscription first
- Or use different user for testing

## Success Criteria

✅ Subscription created in database with status='created'
✅ Razorpay subscription created successfully
✅ Razorpay customer created or found
✅ short_url returned in response
✅ All billing details match plan
✅ Proper error handling for all scenarios
✅ Logs show successful creation
✅ No sensitive data in logs or responses

## Next Steps After Testing

1. Test webhook processing (Task 3)
2. Test credit granting after payment
3. Test subscription management endpoints (Task 8)
4. Test scheduled jobs (Task 6)
5. End-to-end testing with real payment flow
