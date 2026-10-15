# Environment Variables Documentation

This document provides comprehensive documentation for all environment variables used in the Jomobit API.

## Table of Contents
- [Required Variables](#required-variables)
- [Optional Variables](#optional-variables)
- [Razorpay Subscription System](#razorpay-subscription-system)
- [Configuration by Environment](#configuration-by-environment)

---

## Required Variables

These variables MUST be set for the application to function properly.

### Server Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Application environment | `development`, `production`, `test` |
| `PORT` | Server port number | `3000` |
| `FRONTEND_URL` | Frontend application URL | `http://localhost:3000` |

### Database Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/jomobit` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

### Auth0 Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `AUTH0_DOMAIN` | Auth0 tenant domain | `your-domain.auth0.com` |
| `AUTH0_AUDIENCE` | API identifier in Auth0 | `https://api.example.com` |
| `AUTH0_CLIENT_ID` | Auth0 application client ID | `abc123...` |
| `AUTH0_CLIENT_SECRET` | Auth0 application client secret | `secret123...` |
| `AUTH0_WEBHOOK_SECRET` | Secret for Auth0 webhook verification | `webhook-secret-123` |

### Razorpay Configuration

| Variable | Description | Example | Where to Get |
|----------|-------------|---------|--------------|
| `RAZORPAY_KEY_ID` | Razorpay API key ID | `rzp_test_...` or `rzp_live_...` | [Razorpay Dashboard → API Keys](https://dashboard.razorpay.com/app/keys) |
| `RAZORPAY_KEY_SECRET` | Razorpay API key secret | `secret123...` | [Razorpay Dashboard → API Keys](https://dashboard.razorpay.com/app/keys) |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature verification secret | `webhook-secret-123` | [Razorpay Dashboard → Webhooks](https://dashboard.razorpay.com/app/webhooks) |

**Important Notes:**
- Use `rzp_test_` keys for development/testing
- Use `rzp_live_` keys for production only
- Never commit these secrets to version control
- Webhook secret is used to verify webhook authenticity and prevent replay attacks

---

## Optional Variables

These variables have default values and can be customized as needed.

### Logging Configuration

| Variable | Description | Default | Options |
|----------|-------------|---------|---------|
| `LOG_LEVEL` | Logging verbosity level | `info` | `error`, `warn`, `info`, `debug` |

### Subscription Configuration

| Variable | Description | Default | Purpose |
|----------|-------------|---------|---------|
| `DEFAULT_USER_CREDITS` | Initial credits for new users | `3` | Credits granted to users without a subscription |
| `SUBSCRIPTION_RECONCILIATION_ENABLED` | Enable daily subscription sync | `true` | Syncs local subscription data with Razorpay daily at 1 AM |

**Subscription Configuration Details:**

- **DEFAULT_USER_CREDITS**: 
  - Controls the initial credit balance for new users
  - Users can use these credits before subscribing
  - Recommended: 3-5 credits for trial purposes
  
- **SUBSCRIPTION_RECONCILIATION_ENABLED**:
  - When `true`: Runs daily job at 1 AM to sync subscription status with Razorpay
  - When `false`: Disables automatic reconciliation (manual sync required)
  - Recommended: Keep enabled in production for data consistency

### AI Services Configuration

| Variable | Description | Required For |
|----------|-------------|--------------|
| `OPENAI_API_KEY` | OpenAI API key | OpenAI image generation |
| `GEMINI_API_KEY` | Google Gemini API key | Gemini AI features |
| `IDEOGRAM_API_KEY` | Ideogram API key | Ideogram image generation |
| `FAL_KEY` | Fal.ai API key | Fal.ai services |

### ImageKit Configuration

| Variable | Description | Required For |
|----------|-------------|--------------|
| `IMAGEKIT_PUBLIC_KEY` | ImageKit public key | Image storage and CDN |
| `IMAGEKIT_PRIVATE_KEY` | ImageKit private key | Image upload authentication |
| `IMAGEKIT_URL_ENDPOINT` | ImageKit URL endpoint | Image delivery |

### Slack Configuration

| Variable | Description | Required For |
|----------|-------------|--------------|
| `SLACK_WEBHOOK_URL` | Slack webhook URL | Error notifications and alerts |

---

## Razorpay Subscription System

### Overview

The Razorpay subscription system requires three environment variables for secure payment processing:

1. **RAZORPAY_KEY_ID** - Public API key for creating subscriptions
2. **RAZORPAY_KEY_SECRET** - Private API key for server-side operations
3. **RAZORPAY_WEBHOOK_SECRET** - Secret for webhook signature verification

### Setup Instructions

#### 1. Get Razorpay API Keys

1. Log in to [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Navigate to **Settings → API Keys**
3. Generate or view your API keys
4. Copy both Key ID and Key Secret

**For Development:**
```bash
RAZORPAY_KEY_ID=rzp_test_ABC123...
RAZORPAY_KEY_SECRET=DEF456...
```

**For Production:**
```bash
RAZORPAY_KEY_ID=rzp_live_XYZ789...
RAZORPAY_KEY_SECRET=UVW012...
```

#### 2. Configure Webhook Secret

1. Navigate to **Settings → Webhooks** in Razorpay Dashboard
2. Create a new webhook or edit existing one
3. Set webhook URL: `https://your-domain.com/api/webhooks/razorpay`
4. Select events to subscribe to:
   - `subscription.authenticated`
   - `subscription.activated`
   - `subscription.charged`
   - `subscription.pending`
   - `subscription.halted`
   - `subscription.completed`
   - `subscription.cancelled`
   - `payment.failed`
5. Generate or copy the webhook secret
6. Add to your `.env`:

```bash
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret-here
```

#### 3. Configure Subscription Settings

Add optional subscription configuration:

```bash
# Default credits for new users (before subscription)
DEFAULT_USER_CREDITS=3

# Enable daily reconciliation with Razorpay
SUBSCRIPTION_RECONCILIATION_ENABLED=true
```

### Security Best Practices

1. **Never commit secrets to version control**
   - Use `.env` for local development
   - Use environment variables in production
   - Keep `.env.example` with placeholder values only

2. **Use test keys in development**
   - Test keys start with `rzp_test_`
   - Live keys start with `rzp_live_`
   - Never use live keys in development

3. **Rotate secrets regularly**
   - Regenerate webhook secrets periodically
   - Update API keys if compromised
   - Monitor for unauthorized access

4. **Webhook signature verification**
   - Always verify webhook signatures
   - Reject webhooks with invalid signatures
   - Log verification failures for security monitoring

### Webhook Events

The system handles the following Razorpay webhook events:

| Event | Description | Action Taken |
|-------|-------------|--------------|
| `subscription.authenticated` | First payment authorized | Update status, record payment (no credits) |
| `subscription.activated` | Subscription became active | Grant credits, update billing period |
| `subscription.charged` | Recurring payment succeeded | Expire old credits, grant new credits |
| `subscription.pending` | Payment failed, retrying | Update status, increment retry count |
| `subscription.halted` | All retries failed | Expire credits immediately |
| `subscription.completed` | All cycles completed | Update status, maintain credits until period end |
| `subscription.cancelled` | User cancelled | Update status, maintain credits until period end |
| `payment.failed` | Payment attempt failed | Record failure with error details |

---

## Configuration by Environment

### Development Environment

```bash
# Minimal configuration for local development
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:3000
MONGODB_URI=mongodb://localhost:27017/jomobit
REDIS_URL=redis://localhost:6379
LOG_LEVEL=debug

# Auth0 (use development tenant)
AUTH0_DOMAIN=dev-xxx.auth0.com
AUTH0_AUDIENCE=https://api.dev.example.com
AUTH0_CLIENT_ID=dev-client-id
AUTH0_CLIENT_SECRET=dev-client-secret
AUTH0_WEBHOOK_SECRET=dev-webhook-secret

# Razorpay (use test keys)
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=test-secret
RAZORPAY_WEBHOOK_SECRET=test-webhook-secret

# Subscription settings
DEFAULT_USER_CREDITS=5
SUBSCRIPTION_RECONCILIATION_ENABLED=false
```

### Production Environment

```bash
# Production configuration
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://app.jomobit.com
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/jomobit
REDIS_URL=redis://production-redis:6379
LOG_LEVEL=info

# Auth0 (use production tenant)
AUTH0_DOMAIN=jomobit.auth0.com
AUTH0_AUDIENCE=https://api.jomobit.com
AUTH0_CLIENT_ID=prod-client-id
AUTH0_CLIENT_SECRET=prod-client-secret
AUTH0_WEBHOOK_SECRET=prod-webhook-secret

# Razorpay (use live keys)
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=live-secret
RAZORPAY_WEBHOOK_SECRET=live-webhook-secret

# Subscription settings
DEFAULT_USER_CREDITS=3
SUBSCRIPTION_RECONCILIATION_ENABLED=true
```

### Test Environment

```bash
# Test configuration for CI/CD
NODE_ENV=test
PORT=3001
FRONTEND_URL=http://localhost:3001
MONGODB_URI=mongodb://localhost:27017/jomobit-test
REDIS_URL=redis://localhost:6379
LOG_LEVEL=error

# Use test credentials
AUTH0_DOMAIN=test.auth0.com
AUTH0_AUDIENCE=test-audience
AUTH0_CLIENT_ID=test-client-id
AUTH0_CLIENT_SECRET=test-client-secret
AUTH0_WEBHOOK_SECRET=test-webhook-secret

# Razorpay test keys
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=test-secret
RAZORPAY_WEBHOOK_SECRET=test-webhook-secret

# Subscription settings
DEFAULT_USER_CREDITS=10
SUBSCRIPTION_RECONCILIATION_ENABLED=false
```

---

## Validation

The application validates required environment variables on startup. If any required variable is missing, the application will fail to start with a clear error message.

### Checking Configuration

To verify your configuration:

```bash
# Check if all required variables are set
npm run check-env

# Start the application (will validate on startup)
npm start
```

### Common Issues

1. **Missing RAZORPAY_WEBHOOK_SECRET**
   - Error: "RAZORPAY_WEBHOOK_SECRET is required"
   - Solution: Add the webhook secret to your `.env` file

2. **Invalid Razorpay Keys**
   - Error: "Invalid API key"
   - Solution: Verify keys in Razorpay Dashboard, ensure using correct environment keys

3. **Webhook Signature Verification Failed**
   - Error: "Invalid webhook signature"
   - Solution: Verify RAZORPAY_WEBHOOK_SECRET matches the secret in Razorpay Dashboard

---

## Support

For issues related to:
- **Razorpay Configuration**: [Razorpay Support](https://razorpay.com/support/)
- **Auth0 Configuration**: [Auth0 Support](https://support.auth0.com/)
- **Application Issues**: Contact development team

---

## Changelog

### 2024-12-10
- Added Razorpay subscription system environment variables
- Added DEFAULT_USER_CREDITS configuration
- Added SUBSCRIPTION_RECONCILIATION_ENABLED configuration
- Added comprehensive documentation for webhook setup
- Added security best practices section
