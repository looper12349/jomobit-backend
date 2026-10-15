# Frontend Subscription API Integration Guide

Complete guide for integrating subscription management into your frontend application.

---

## Table of Contents

1. [Setup](#setup)
2. [Authentication](#authentication)
3. [Get Available Plans](#get-available-plans)
4. [Create Subscription](#create-subscription)
5. [Verify Payment](#verify-payment-signature)
6. [Get Current Subscription](#get-current-subscription)
7. [Upgrade/Downgrade Subscription](#upgradedowngrade-subscription)
8. [Cancel Subscription](#cancel-subscription)
9. [Error Handling](#error-handling)
10. [Complete Flow Examples](#complete-flow-examples)

---

## Setup

### Prerequisites

1. **Razorpay Account**: Sign up at [razorpay.com](https://razorpay.com)
2. **API Keys**: Get your Key ID and Key Secret from Razorpay Dashboard
3. **Webhook Setup**: Configure webhook URL in Razorpay Dashboard

### Environment Variables

Add these to your `.env` file:

```bash
# Frontend
REACT_APP_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
REACT_APP_API_BASE_URL=https://your-api.com

# Backend (already configured)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

### Add Razorpay SDK

**Option 1: Via Script Tag (Recommended)**

Add to your `public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Your App</title>
    
    <!-- Add Razorpay Checkout Script -->
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

**Option 2: Dynamic Loading (React)**

```javascript
// hooks/useRazorpay.js
import { useEffect, useState } from 'react';

export const useRazorpay = () => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Check if already loaded
    if (window.Razorpay) {
      setLoaded(true);
      return;
    }

    // Load script
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => setLoaded(true);
    script.onerror = () => console.error('Failed to load Razorpay SDK');
    
    document.body.appendChild(script);

    return () => {
      if (script.parentNode) {
        document.body.removeChild(script);
      }
    };
  }, []);

  return { loaded, Razorpay: window.Razorpay };
};

// Usage in component
const MyComponent = () => {
  const { loaded } = useRazorpay();

  if (!loaded) {
    return <div>Loading payment gateway...</div>;
  }

  return <SubscribeButton />;
};
```

---

## Authentication

All subscription endpoints require authentication via Bearer token (Auth0 JWT).

```javascript
const headers = {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
};
```

---

## Get Available Plans

**Endpoint:** `GET /api/subscriptions/plans`

**Purpose:** Fetch all available subscription plans to display in your pricing page.

**Authentication:** Not required (public endpoint)

### Request

```javascript
const response = await fetch('https://your-api.com/api/subscriptions/plans', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
```

### Response (200 OK)

```json
{
  "success": true,
  "plans": [
    {
      "_id": "68e9927e4577fc85bd4258da",
      "name": "Pro Monthly",
      "planId": "pro_monthly",
      "description": "Perfect for small teams",
      "pricing": {
        "amount": 2600,
        "currency": "INR",
        "interval": "monthly",
        "intervalCount": 1
      },
      "features": {
        "credits": {
          "monthly": 100,
          "rollover": false
        },
        "businessProfiles": {
          "limit": 5
        }
      },
      "tier": "premium",
      "status": "active"
    },
    {
      "_id": "68e997b04577fc85bd4258e1",
      "name": "Max Monthly",
      "planId": "max_monthly",
      "description": "For growing businesses",
      "pricing": {
        "amount": 8800,
        "currency": "INR",
        "interval": "monthly",
        "intervalCount": 1
      },
      "features": {
        "credits": {
          "monthly": 500,
          "rollover": true
        },
        "businessProfiles": {
          "limit": 20
        }
      },
      "tier": "enterprise",
      "status": "active"
    }
  ]
}
```

### Frontend Usage

```javascript
// React example
const [plans, setPlans] = useState([]);

useEffect(() => {
  async function fetchPlans() {
    try {
      const response = await fetch('/api/subscriptions/plans');
      const data = await response.json();
      
      if (data.success) {
        setPlans(data.plans);
      }
    } catch (error) {
      console.error('Failed to fetch plans:', error);
    }
  }
  
  fetchPlans();
}, []);

// Display plans
return (
  <div className="pricing-grid">
    {plans.map(plan => (
      <PricingCard
        key={plan._id}
        name={plan.name}
        price={plan.pricing.amount / 100} // Convert paise to rupees
        interval={plan.pricing.interval}
        features={plan.features}
        onSelect={() => handleSelectPlan(plan.planId)}
      />
    ))}
  </div>
);
```

---

## Create Subscription

**Endpoint:** `POST /api/subscriptions/create`

**Purpose:** Create a new subscription when user doesn't have an active subscription.

**Authentication:** Required

### When to Use

- User clicks "Subscribe" on a plan
- User has NO active subscription
- First-time subscription creation

### Payment Flow Options

You have two options for payment:

1. **Razorpay SDK Popup** (Recommended) - Better UX, stays on your site
2. **Redirect to Payment Link** - Simple, redirects to Razorpay hosted page

---

## Option 1: Razorpay SDK Popup (Recommended)

### Step 1: Add Razorpay Script to Your HTML

```html
<!-- Add this in your index.html or layout -->
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

### Step 2: Create Subscription Request

```javascript
const createSubscription = async (planId) => {
  const response = await fetch('https://your-api.com/api/subscriptions/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      planId: 'pro_monthly',        // Required: Plan identifier
      customerNotify: true,          // Optional: Send email/SMS to customer
      notes: {                       // Optional: Custom metadata
        source: 'web_app',
        campaign: 'summer_sale'
      }
    })
  });

  const data = await response.json();
  return data;
};
```

### Response (201 Created)

```json
{
  "success": true,
  "message": "Subscription created successfully. Please complete payment using the provided URL.",
  "subscription": {
    "_id": "68f45af6a7edd47e2d093621",
    "razorpaySubscriptionId": "sub_RVBQgdqPzNSB46",
    "short_url": "https://rzp.io/i/abc123xyz",
    "status": "created",
    "billing": {
      "amount": 2600,
      "currency": "INR",
      "interval": "monthly",
      "intervalCount": 1
    },
    "totalCount": 120,
    "paidCount": 0,
    "remainingCount": 120,
    "createdAt": "2025-10-19T03:28:54.975Z"
  },
  "plan": {
    "_id": "68e9927e4577fc85bd4258da",
    "name": "Pro Monthly",
    "planId": "pro_monthly",
    "description": "Perfect for small teams",
    "pricing": {
      "amount": 2600,
      "currency": "INR",
      "interval": "monthly"
    },
    "features": {
      "credits": {
        "monthly": 100
      }
    }
  }
}
```

### Step 3: Open Razorpay Checkout Popup

```javascript
const openRazorpayCheckout = (subscriptionData, userInfo) => {
  const options = {
    key: process.env.REACT_APP_RAZORPAY_KEY_ID, // Your Razorpay Key ID
    subscription_id: subscriptionData.razorpaySubscriptionId,
    name: 'Your Company Name',
    description: subscriptionData.plan.name,
    image: '/your_logo.png', // Your company logo
    
    // Handler function - called on successful payment
    handler: async function (response) {
      // response contains:
      // - razorpay_payment_id
      // - razorpay_subscription_id
      // - razorpay_signature
      
      try {
        // Verify payment signature
        const verifyResponse = await fetch('/api/subscriptions/verify', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_subscription_id: response.razorpay_subscription_id,
            razorpay_signature: response.razorpay_signature
          })
        });

        const verifyData = await verifyResponse.json();

        if (verifyData.success && verifyData.verified) {
          // Payment verified successfully
          toast.success('Subscription activated successfully!');
          
          // Redirect to success page or dashboard
          navigate('/subscription/success');
          
          // Refresh subscription data
          await refreshSubscription();
        } else {
          // Verification failed
          toast.error('Payment verification failed. Please contact support.');
        }
      } catch (error) {
        console.error('Payment verification error:', error);
        toast.error('Failed to verify payment. Please contact support.');
      }
    },
    
    // Prefill customer information
    prefill: {
      name: userInfo.name,
      email: userInfo.email,
      contact: userInfo.phone || ''
    },
    
    // Additional notes
    notes: {
      userId: userInfo.id,
      planId: subscriptionData.plan.planId
    },
    
    // Theme customization
    theme: {
      color: '#3399cc' // Your brand color
    },
    
    // Modal options
    modal: {
      ondismiss: function() {
        // Called when user closes the popup
        console.log('Payment popup closed');
        toast.info('Payment cancelled');
      }
    }
  };

  const razorpay = new window.Razorpay(options);
  
  // Handle payment failure
  razorpay.on('payment.failed', function (response) {
    console.error('Payment failed:', response.error);
    toast.error(`Payment failed: ${response.error.description}`);
  });

  // Open the checkout popup
  razorpay.open();
};
```

### Step 4: Complete Frontend Implementation

```javascript
const handleSubscribe = async (planId) => {
  try {
    setLoading(true);
    
    // Step 1: Create subscription
    const response = await fetch('/api/subscriptions/create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ planId })
    });

    const data = await response.json();

    if (data.success) {
      // Step 2: Open Razorpay checkout popup
      openRazorpayCheckout(data.subscription, {
        name: user.name,
        email: user.email,
        phone: user.phone,
        id: user.id
      });
    } else {
      // Handle error
      setError(data.message);
    }
  } catch (error) {
    console.error('Subscription creation failed:', error);
    setError('Failed to create subscription');
  } finally {
    setLoading(false);
  }
};
```

### Complete React Component Example

```javascript
import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { toast } from 'react-toastify';

const SubscribeButton = ({ plan }) => {
  const { user, accessToken } = useAuth();
  const [loading, setLoading] = useState(false);

  // Load Razorpay script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const verifyPayment = async (paymentResponse) => {
    try {
      const response = await fetch('/api/subscriptions/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          razorpay_payment_id: paymentResponse.razorpay_payment_id,
          razorpay_subscription_id: paymentResponse.razorpay_subscription_id,
          razorpay_signature: paymentResponse.razorpay_signature
        })
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Verification error:', error);
      throw error;
    }
  };

  const openRazorpayCheckout = (subscriptionData) => {
    const options = {
      key: process.env.REACT_APP_RAZORPAY_KEY_ID,
      subscription_id: subscriptionData.razorpaySubscriptionId,
      name: 'Your Company',
      description: subscriptionData.plan.name,
      image: '/logo.png',
      
      handler: async function (response) {
        try {
          const verifyResult = await verifyPayment(response);
          
          if (verifyResult.success && verifyResult.verified) {
            toast.success('🎉 Subscription activated successfully!');
            window.location.href = '/dashboard';
          } else {
            toast.error('Payment verification failed. Please contact support.');
          }
        } catch (error) {
          toast.error('Failed to verify payment. Please contact support.');
        }
      },
      
      prefill: {
        name: user.name,
        email: user.email,
        contact: user.phone || ''
      },
      
      notes: {
        userId: user.id,
        planId: plan.planId
      },
      
      theme: {
        color: '#3399cc'
      },
      
      modal: {
        ondismiss: function() {
          toast.info('Payment cancelled');
          setLoading(false);
        }
      }
    };

    const razorpay = new window.Razorpay(options);
    
    razorpay.on('payment.failed', function (response) {
      toast.error(`Payment failed: ${response.error.description}`);
      setLoading(false);
    });

    razorpay.open();
  };

  const handleSubscribe = async () => {
    try {
      setLoading(true);
      
      const response = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          planId: plan.planId,
          customerNotify: true
        })
      });

      const data = await response.json();

      if (data.success) {
        openRazorpayCheckout(data.subscription);
      } else {
        toast.error(data.message);
        setLoading(false);
      }
    } catch (error) {
      console.error('Subscription creation failed:', error);
      toast.error('Failed to create subscription');
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleSubscribe}
      disabled={loading}
      className="subscribe-button"
    >
      {loading ? 'Processing...' : `Subscribe to ${plan.name}`}
    </button>
  );
};

export default SubscribeButton;
```

---

## Option 2: Redirect to Payment Link (Simple)

If you prefer a simpler approach without the SDK:

```javascript
const handleSubscribe = async (planId) => {
  try {
    setLoading(true);
    
    const response = await fetch('/api/subscriptions/create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ planId })
    });

    const data = await response.json();

    if (data.success) {
      // Redirect user to Razorpay payment page
      window.location.href = data.subscription.short_url;
      
      // OR open in new tab
      // window.open(data.subscription.short_url, '_blank');
    } else {
      // Handle error
      setError(data.message);
    }
  } catch (error) {
    console.error('Subscription creation failed:', error);
    setError('Failed to create subscription');
  } finally {
    setLoading(false);
  }
};
```

---

## Verify Payment Signature

**Endpoint:** `POST /api/subscriptions/verify`

**Purpose:** Verify Razorpay payment signature after successful payment in checkout popup.

**Authentication:** Required

**Important:** This endpoint ONLY verifies the signature. Actual payment recording and credit granting happens via webhooks.

### Request

```javascript
const verifyPayment = async (paymentResponse) => {
  const response = await fetch('https://your-api.com/api/subscriptions/verify', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      razorpay_payment_id: paymentResponse.razorpay_payment_id,
      razorpay_subscription_id: paymentResponse.razorpay_subscription_id,
      razorpay_signature: paymentResponse.razorpay_signature
    })
  });

  const data = await response.json();
  return data;
};
```

### Response (200 OK - Verified)

```json
{
  "success": true,
  "verified": true,
  "message": "Payment signature verified successfully",
  "data": {
    "razorpay_payment_id": "pay_1234567890abcdef",
    "razorpay_subscription_id": "sub_1234567890abcdef"
  }
}
```

### Response (400 - Verification Failed)

```json
{
  "success": false,
  "verified": false,
  "error": "SIGNATURE_VERIFICATION_FAILED",
  "message": "Payment signature verification failed"
}
```

### When to Use

- Called in the `handler` function of Razorpay checkout
- Used to verify payment authenticity before showing success message
- Does NOT record payment (webhooks handle that)
- Only for UI feedback to user

### Error Responses

**409 Conflict - User already has active subscription**
```json
{
  "success": false,
  "error": "Active subscription exists",
  "message": "User already has an active subscription",
  "subscription": {
    "_id": "68f45af6a7edd47e2d093621",
    "status": "active",
    "planId": "pro_monthly"
  }
}
```

**Action:** Redirect user to upgrade/downgrade flow instead.

---

## Get Current Subscription

**Endpoint:** `GET /api/subscriptions/current`

**Purpose:** Check if user has an active subscription and display current plan details.

**Authentication:** Required

### When to Use

- On app load to determine user's subscription status
- Before showing "Subscribe" vs "Upgrade" buttons
- To display current plan in settings/account page

### Request

```javascript
const getCurrentSubscription = async () => {
  const response = await fetch('https://your-api.com/api/subscriptions/current', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();
  return data;
};
```

### Response (200 OK - Has Subscription)

```json
{
  "success": true,
  "subscription": {
    "_id": "68f45af6a7edd47e2d093621",
    "userId": "689e5997c3bfa8e078fa236f",
    "status": "active",
    "currentPeriodStart": "2025-10-19T03:30:42.000Z",
    "currentPeriodEnd": "2025-11-19T03:30:42.000Z",
    "cancelAtPeriodEnd": false,
    "cancelledAt": null,
    "scheduledChange": null,
    "billing": {
      "amount": 2600,
      "currency": "INR",
      "interval": "monthly",
      "intervalCount": 1
    },
    "createdAt": "2025-10-19T03:28:54.975Z",
    "updatedAt": "2025-10-19T03:40:55.459Z"
  },
  "plan": {
    "_id": "68e9927e4577fc85bd4258da",
    "name": "Pro Monthly",
    "planId": "pro_monthly",
    "description": "Perfect for small teams",
    "pricing": {
      "amount": 2600,
      "currency": "INR",
      "interval": "monthly"
    },
    "features": {
      "credits": {
        "monthly": 100
      }
    },
    "tier": "premium"
  }
}
```

### Response (404 - No Subscription)

```json
{
  "success": false,
  "error": "No active subscription",
  "message": "No active subscription found"
}
```

### Frontend Implementation

```javascript
// React example
const [subscription, setSubscription] = useState(null);
const [hasSubscription, setHasSubscription] = useState(false);

useEffect(() => {
  async function checkSubscription() {
    try {
      const response = await fetch('/api/subscriptions/current', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const data = await response.json();

      if (response.status === 200 && data.subscription) {
        setSubscription(data.subscription);
        setHasSubscription(true);
      } else {
        setHasSubscription(false);
      }
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    }
  }

  checkSubscription();
}, [accessToken]);

// Conditional rendering
return (
  <div>
    {hasSubscription ? (
      <div>
        <h2>Current Plan: {subscription.plan.name}</h2>
        <p>₹{subscription.billing.amount / 100}/{subscription.billing.interval}</p>
        <p>Renews on: {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>
        <button onClick={() => navigate('/upgrade')}>Upgrade Plan</button>
        <button onClick={() => handleCancel()}>Cancel Subscription</button>
      </div>
    ) : (
      <div>
        <h2>No Active Subscription</h2>
        <button onClick={() => navigate('/pricing')}>View Plans</button>
      </div>
    )}
  </div>
);
```

---

## Upgrade/Downgrade Subscription

**Endpoint:** `POST /api/subscriptions/upgrade`

**Purpose:** Change user's subscription to a different plan (upgrade or downgrade).

**Authentication:** Required

### When to Use

- User wants to upgrade to a higher-tier plan
- User wants to downgrade to a lower-tier plan
- User has an ACTIVE subscription

### Important Business Rules

1. **Upgrades** can be immediate or scheduled
2. **Downgrades** are ALWAYS scheduled (applied at cycle end)
3. Immediate upgrades charge prorated amount
4. Scheduled changes take effect at next billing cycle

### Request

```javascript
const changeSubscription = async (newPlanId, immediate = false) => {
  const response = await fetch('https://your-api.com/api/subscriptions/upgrade', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      newPlanId: 'max_monthly',     // Required: New plan identifier
      immediate: false,              // Optional: Apply immediately (default: false)
      reason: 'user_upgrade'         // Optional: Reason for change
    })
  });

  const data = await response.json();
  return data;
};
```

### Response (200 OK - Immediate Upgrade)

```json
{
  "success": true,
  "message": "Plan upgrade initiated successfully. Changes will be confirmed by payment processor.",
  "immediate": true,
  "subscription": {
    "_id": "68f45af6a7edd47e2d093621",
    "status": "active",
    "currentPeriodEnd": "2025-11-19T03:30:42.000Z",
    "paidCount": 1,
    "remainingCount": 119
  },
  "oldPlan": {
    "_id": "68e9927e4577fc85bd4258da",
    "name": "Pro Monthly",
    "planId": "pro_monthly",
    "pricing": {
      "amount": 2600,
      "currency": "INR",
      "interval": "monthly"
    }
  },
  "newPlan": {
    "_id": "68e997b04577fc85bd4258e1",
    "name": "Max Monthly",
    "planId": "max_monthly",
    "pricing": {
      "amount": 8800,
      "currency": "INR",
      "interval": "monthly"
    }
  },
  "changeType": "upgrade",
  "effectiveDate": "2025-10-19T03:33:36.703Z"
}
```

### Response (200 OK - Scheduled Downgrade)

```json
{
  "success": true,
  "message": "Plan downgrade scheduled successfully. Changes will take effect at the end of your current billing cycle.",
  "immediate": false,
  "scheduled": true,
  "subscription": {
    "_id": "68f45af6a7edd47e2d093621",
    "status": "active",
    "currentPeriodEnd": "2025-11-19T03:30:42.000Z"
  },
  "scheduledChange": {
    "newPlan": "pro_monthly",
    "effectiveDate": "2025-11-19T03:30:42.000Z",
    "changeType": "downgrade"
  },
  "oldPlan": {
    "name": "Max Monthly",
    "planId": "max_monthly",
    "pricing": {
      "amount": 8800
    }
  },
  "newPlan": {
    "name": "Pro Monthly",
    "planId": "pro_monthly",
    "pricing": {
      "amount": 2600
    }
  },
  "changeType": "downgrade"
}
```

### Frontend Implementation

```javascript
// Upgrade/Downgrade Component
const PlanChangeModal = ({ currentPlan, targetPlan, onClose }) => {
  const [immediate, setImmediate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isUpgrade = targetPlan.pricing.amount > currentPlan.pricing.amount;
  const isDowngrade = targetPlan.pricing.amount < currentPlan.pricing.amount;

  const handleChangePlan = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/subscriptions/upgrade', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          newPlanId: targetPlan.planId,
          immediate: immediate,
          reason: isUpgrade ? 'user_upgrade' : 'user_downgrade'
        })
      });

      const data = await response.json();

      if (data.success) {
        if (data.immediate) {
          // Immediate change - show success and refresh
          toast.success('Plan upgraded successfully!');
          // Refresh subscription data
          await refreshSubscription();
        } else {
          // Scheduled change - show when it will take effect
          toast.success(
            `Plan change scheduled for ${new Date(data.scheduledChange.effectiveDate).toLocaleDateString()}`
          );
        }
        onClose();
      } else {
        setError(data.message);
      }
    } catch (error) {
      console.error('Plan change failed:', error);
      setError('Failed to change plan. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal">
      <h2>
        {isUpgrade ? 'Upgrade' : 'Downgrade'} to {targetPlan.name}
      </h2>

      <div className="plan-comparison">
        <div>
          <h3>Current Plan</h3>
          <p>{currentPlan.name}</p>
          <p>₹{currentPlan.pricing.amount / 100}/{currentPlan.pricing.interval}</p>
        </div>
        <div>
          <h3>New Plan</h3>
          <p>{targetPlan.name}</p>
          <p>₹{targetPlan.pricing.amount / 100}/{targetPlan.pricing.interval}</p>
        </div>
      </div>

      {isUpgrade && (
        <div className="immediate-option">
          <label>
            <input
              type="checkbox"
              checked={immediate}
              onChange={(e) => setImmediate(e.target.checked)}
            />
            Apply immediately (prorated charge)
          </label>
          {immediate && (
            <p className="info">
              You'll be charged a prorated amount for the remaining days in your current cycle.
            </p>
          )}
        </div>
      )}

      {isDowngrade && (
        <div className="downgrade-notice">
          <p>⚠️ Downgrades take effect at the end of your current billing cycle.</p>
          <p>You'll continue to have access to {currentPlan.name} features until then.</p>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <div className="actions">
        <button onClick={onClose} disabled={loading}>
          Cancel
        </button>
        <button onClick={handleChangePlan} disabled={loading}>
          {loading ? 'Processing...' : `Confirm ${isUpgrade ? 'Upgrade' : 'Downgrade'}`}
        </button>
      </div>
    </div>
  );
};
```

### Error Responses

**404 - No Active Subscription**
```json
{
  "success": false,
  "error": "NO_ACTIVE_SUBSCRIPTION",
  "message": "No active subscription found"
}
```

**400 - Same Plan**
```json
{
  "success": false,
  "error": "SAME_PLAN",
  "message": "Cannot change to the same plan"
}
```

**400 - Plan Not Found**
```json
{
  "success": false,
  "error": "PLAN_NOT_FOUND",
  "message": "Invalid plan ID provided"
}
```

**500 - Razorpay Error**
```json
{
  "success": false,
  "error": "RAZORPAY_UPDATE_FAILED",
  "message": "Failed to update subscription in Razorpay",
  "details": "Can't update subscription when cycle start is in future"
}
```

---

## Cancel Subscription

**Endpoint:** `POST /api/subscriptions/cancel`

**Purpose:** Cancel user's active subscription.

**Authentication:** Required

### Request

```javascript
const cancelSubscription = async (immediately = false) => {
  const response = await fetch('https://your-api.com/api/subscriptions/cancel', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      immediately: false,           // Optional: Cancel immediately (default: false)
      reason: 'user_cancellation'   // Optional: Cancellation reason
    })
  });

  const data = await response.json();
  return data;
};
```

### Response (200 OK - Scheduled Cancellation)

```json
{
  "success": true,
  "message": "Subscription will be cancelled at the end of current period",
  "subscription": {
    "_id": "68f45af6a7edd47e2d093621",
    "status": "active",
    "cancelAtPeriodEnd": true,
    "currentPeriodEnd": "2025-11-19T03:30:42.000Z"
  },
  "cancelledImmediately": false
}
```

### Response (200 OK - Immediate Cancellation)

```json
{
  "success": true,
  "message": "Subscription cancelled immediately",
  "subscription": {
    "_id": "68f45af6a7edd47e2d093621",
    "status": "cancelled",
    "cancelledAt": "2025-10-19T10:15:30.000Z"
  },
  "cancelledImmediately": true
}
```

### Frontend Implementation

```javascript
const CancelSubscriptionModal = ({ subscription, onClose, onSuccess }) => {
  const [immediately, setImmediately] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel your subscription?')) {
      return;
    }

    try {
      setLoading(true);

      const response = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          immediately,
          reason: reason || 'user_cancellation'
        })
      });

      const data = await response.json();

      if (data.success) {
        if (data.cancelledImmediately) {
          toast.success('Subscription cancelled immediately');
        } else {
          toast.success(
            `Subscription will be cancelled on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
          );
        }
        onSuccess();
        onClose();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error('Cancellation failed:', error);
      toast.error('Failed to cancel subscription');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal">
      <h2>Cancel Subscription</h2>

      <div className="cancellation-options">
        <label>
          <input
            type="radio"
            checked={!immediately}
            onChange={() => setImmediately(false)}
          />
          <div>
            <strong>Cancel at period end</strong>
            <p>Keep access until {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>
          </div>
        </label>

        <label>
          <input
            type="radio"
            checked={immediately}
            onChange={() => setImmediately(true)}
          />
          <div>
            <strong>Cancel immediately</strong>
            <p>Lose access right away (no refund)</p>
          </div>
        </label>
      </div>

      <div className="reason">
        <label>Reason for cancellation (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Help us improve..."
        />
      </div>

      <div className="actions">
        <button onClick={onClose} disabled={loading}>
          Keep Subscription
        </button>
        <button onClick={handleCancel} disabled={loading} className="danger">
          {loading ? 'Processing...' : 'Confirm Cancellation'}
        </button>
      </div>
    </div>
  );
};
```

---

## Error Handling

### Common Error Codes

| Error Code | HTTP Status | Description | Action |
|------------|-------------|-------------|--------|
| `Active subscription exists` | 409 | User already has subscription | Redirect to upgrade flow |
| `NO_ACTIVE_SUBSCRIPTION` | 404 | No active subscription found | Show create subscription flow |
| `PLAN_NOT_FOUND` | 400 | Invalid plan ID | Show available plans |
| `SAME_PLAN` | 400 | Trying to change to same plan | Disable button |
| `RAZORPAY_UPDATE_FAILED` | 500 | Razorpay API error | Show error message, retry |
| `User not found` | 404 | User profile not found | Re-authenticate user |
| `Unauthorized` | 401 | Invalid/expired token | Redirect to login |

### Global Error Handler

```javascript
const handleSubscriptionError = (error, response) => {
  // Handle HTTP errors
  if (!response.ok) {
    switch (response.status) {
      case 401:
        // Unauthorized - redirect to login
        logout();
        navigate('/login');
        break;

      case 404:
        if (error.error === 'NO_ACTIVE_SUBSCRIPTION') {
          // No subscription - show pricing page
          navigate('/pricing');
        } else {
          toast.error('Resource not found');
        }
        break;

      case 409:
        if (error.error === 'Active subscription exists') {
          // Already has subscription - show upgrade page
          navigate('/subscription/manage');
        }
        break;

      case 400:
        // Validation error - show specific message
        toast.error(error.message);
        break;

      case 500:
        // Server error - show generic message
        toast.error('Something went wrong. Please try again later.');
        break;

      default:
        toast.error(error.message || 'An error occurred');
    }
  }
};

// Usage
try {
  const response = await fetch('/api/subscriptions/create', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ planId })
  });

  const data = await response.json();

  if (!response.ok) {
    handleSubscriptionError(data, response);
    return;
  }

  // Success handling
  handleSuccess(data);
} catch (error) {
  console.error('Network error:', error);
  toast.error('Network error. Please check your connection.');
}
```

---

## Complete Flow Examples

### Flow 1: New User Subscribing

```javascript
// Step 1: Check if user has subscription
const checkSubscriptionStatus = async () => {
  const response = await fetch('/api/subscriptions/current', {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (response.status === 404) {
    // No subscription - show pricing page
    return { hasSubscription: false };
  }

  const data = await response.json();
  return { hasSubscription: true, subscription: data.subscription };
};

// Step 2: Fetch available plans
const fetchPlans = async () => {
  const response = await fetch('/api/subscriptions/plans');
  const data = await response.json();
  return data.plans;
};

// Step 3: Create subscription
const subscribe = async (planId) => {
  const response = await fetch('/api/subscriptions/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ planId })
  });

  const data = await response.json();

  if (data.success) {
    // Redirect to Razorpay payment
    window.location.href = data.subscription.short_url;
  }
};

// Complete flow
const handleNewSubscription = async () => {
  // Check status
  const status = await checkSubscriptionStatus();

  if (status.hasSubscription) {
    // Already has subscription
    navigate('/subscription/manage');
    return;
  }

  // Fetch and display plans
  const plans = await fetchPlans();
  setAvailablePlans(plans);

  // User selects plan
  // ... UI interaction ...

  // Create subscription
  await subscribe(selectedPlanId);
};
```

### Flow 2: Existing User Upgrading

```javascript
const handleUpgrade = async (newPlanId) => {
  // Step 1: Get current subscription
  const currentResponse = await fetch('/api/subscriptions/current', {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (currentResponse.status === 404) {
    // No subscription - redirect to create
    navigate('/pricing');
    return;
  }

  const currentData = await currentResponse.json();
  const currentPlan = currentData.plan;

  // Step 2: Get target plan details
  const plansResponse = await fetch('/api/subscriptions/plans');
  const plansData = await plansResponse.json();
  const targetPlan = plansData.plans.find(p => p.planId === newPlanId);

  // Step 3: Determine if upgrade or downgrade
  const isUpgrade = targetPlan.pricing.amount > currentPlan.pricing.amount;

  // Step 4: Show confirmation modal
  const confirmed = await showPlanChangeModal({
    currentPlan,
    targetPlan,
    isUpgrade
  });

  if (!confirmed) return;

  // Step 5: Execute plan change
  const response = await fetch('/api/subscriptions/upgrade', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      newPlanId: targetPlan.planId,
      immediate: isUpgrade, // Upgrades can be immediate
      reason: isUpgrade ? 'user_upgrade' : 'user_downgrade'
    })
  });

  const data = await response.json();

  if (data.success) {
    if (data.immediate) {
      toast.success('Plan upgraded successfully!');
    } else {
      toast.success(`Plan change scheduled for ${new Date(data.scheduledChange.effectiveDate).toLocaleDateString()}`);
    }

    // Refresh subscription data
    await refreshSubscription();
  }
};
```

### Flow 3: Complete Subscription Management Page

```javascript
const SubscriptionManagementPage = () => {
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSubscriptionData();
  }, []);

  const loadSubscriptionData = async () => {
    try {
      setLoading(true);

      // Fetch current subscription
      const subResponse = await fetch('/api/subscriptions/current', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      let currentSub = null;
      if (subResponse.ok) {
        const subData = await subResponse.json();
        currentSub = subData.subscription;
        setSubscription(currentSub);
      }

      // Fetch available plans
      const plansResponse = await fetch('/api/subscriptions/plans');
      const plansData = await plansResponse.json();
      setPlans(plansData.plans);

    } catch (error) {
      console.error('Failed to load subscription data:', error);
      toast.error('Failed to load subscription information');
    } finally {
      setLoading(false);
    }
  };

  const handlePlanChange = async (newPlanId) => {
    // Implementation from Flow 2
    await handleUpgrade(newPlanId);
    await loadSubscriptionData(); // Refresh
  };

  const handleCancelSubscription = async () => {
    const response = await fetch('/api/subscriptions/cancel', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        immediately: false,
        reason: 'user_cancellation'
      })
    });

    const data = await response.json();

    if (data.success) {
      toast.success('Subscription will be cancelled at period end');
      await loadSubscriptionData(); // Refresh
    }
  };

  if (loading) return <LoadingSpinner />;

  if (!subscription) {
    return (
      <div>
        <h1>No Active Subscription</h1>
        <p>Choose a plan to get started</p>
        <PricingTable plans={plans} onSelectPlan={handlePlanChange} />
      </div>
    );
  }

  return (
    <div className="subscription-management">
      <CurrentPlanCard
        subscription={subscription}
        onCancel={handleCancelSubscription}
      />

      <AvailablePlansSection
        currentPlan={subscription.plan}
        plans={plans}
        onSelectPlan={handlePlanChange}
      />

      {subscription.scheduledChange && (
        <ScheduledChangeNotice
          scheduledChange={subscription.scheduledChange}
        />
      )}

      {subscription.cancelAtPeriodEnd && (
        <CancellationNotice
          endDate={subscription.currentPeriodEnd}
        />
      )}
    </div>
  );
};
```

---

## Best Practices

### 1. Always Check Subscription Status First

```javascript
// Before showing "Subscribe" button
const status = await checkSubscriptionStatus();
if (status.hasSubscription) {
  showUpgradeButton();
} else {
  showSubscribeButton();
}
```

### 2. Handle Razorpay Redirects Properly

```javascript
// After creating subscription
if (data.success) {
  // Save subscription ID to localStorage for post-payment verification
  localStorage.setItem('pendingSubscription', data.subscription._id);

  // Redirect to Razorpay
  window.location.href = data.subscription.short_url;
}

// On return from Razorpay (callback page)
useEffect(() => {
  const pendingSubId = localStorage.getItem('pendingSubscription');
  if (pendingSubId) {
    // Verify subscription status
    verifySubscription(pendingSubId);
    localStorage.removeItem('pendingSubscription');
  }
}, []);
```

### 3. Show Clear Feedback for Scheduled Changes

```javascript
{subscription.scheduledChange && (
  <div className="alert alert-info">
    <strong>Scheduled Change:</strong>
    Your plan will change to {subscription.scheduledChange.newPlan} on{' '}
    {new Date(subscription.scheduledChange.effectiveDate).toLocaleDateString()}
  </div>
)}
```

### 4. Disable Actions During Loading

```javascript
<button
  onClick={handleUpgrade}
  disabled={loading || subscription.scheduledChange}
>
  {loading ? 'Processing...' : 'Upgrade Plan'}
</button>
```

### 5. Refresh Subscription Data After Changes

```javascript
const refreshSubscription = async () => {
  const response = await fetch('/api/subscriptions/current', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  setSubscription(data.subscription);
};

// After any subscription change
await handleUpgrade(newPlanId);
await refreshSubscription();
```

---

## Payment Flow Architecture

### How It Works

```
┌─────────────┐
│   Frontend  │
└──────┬──────┘
       │
       │ 1. POST /create
       ▼
┌─────────────┐
│   Backend   │──────────────┐
└──────┬──────┘              │
       │                     │ 2. Create subscription
       │ 3. Return           │    in Razorpay
       │    subscription_id  │
       ▼                     ▼
┌─────────────┐         ┌──────────┐
│   Frontend  │         │ Razorpay │
└──────┬──────┘         └────┬─────┘
       │                     │
       │ 4. Open popup       │
       │    with sub_id      │
       ├────────────────────►│
       │                     │
       │ 5. User pays        │
       │◄────────────────────┤
       │                     │
       │ 6. Payment response │
       │    (payment_id,     │
       │     signature)      │
       ▼                     │
┌─────────────┐              │
│   Frontend  │              │
└──────┬──────┘              │
       │                     │
       │ 7. POST /verify     │
       │    (signature)      │
       ▼                     │
┌─────────────┐              │
│   Backend   │              │
└──────┬──────┘              │
       │                     │
       │ 8. Verify signature │
       │    Return success   │
       ▼                     │
┌─────────────┐              │
│   Frontend  │              │
│ Show success│              │
└─────────────┘              │
                             │
                             │ 9. Webhook
                             │    (async)
                             ▼
                        ┌──────────┐
                        │ Backend  │
                        │ - Record │
                        │   payment│
                        │ - Grant  │
                        │   credits│
                        └──────────┘
```

### Important Notes

1. **Signature Verification** (`/verify` endpoint):
   - Only verifies payment authenticity
   - Used for immediate UI feedback
   - Does NOT record payment or grant credits

2. **Webhook Processing** (async):
   - Razorpay sends webhook after payment
   - Backend records payment in database
   - Backend grants subscription credits
   - This is the source of truth

3. **Why Two Steps?**
   - `/verify`: Fast UI feedback (user sees success immediately)
   - Webhook: Reliable payment recording (handles retries, failures)

### Error Scenarios

**Scenario 1: Payment Successful, Verification Fails**
- User paid successfully
- Signature verification failed (network issue)
- **Result**: Webhook will still process payment
- **Action**: Show "Payment processing" message, check status later

**Scenario 2: Payment Failed**
- User's payment declined
- `payment.failed` event triggered
- **Result**: No webhook, no charges
- **Action**: Show error message, allow retry

**Scenario 3: User Closes Popup**
- User closes payment popup without paying
- `modal.ondismiss` triggered
- **Result**: No payment, no charges
- **Action**: Show "Payment cancelled" message

---

## Summary

### Key Endpoints

| Endpoint | Method | Purpose | Auth Required |
|----------|--------|---------|---------------|
| `/api/subscriptions/plans` | GET | Get available plans | No |
| `/api/subscriptions/create` | POST | Create new subscription | Yes |
| `/api/subscriptions/verify` | POST | Verify payment signature | Yes |
| `/api/subscriptions/current` | GET | Get current subscription | Yes |
| `/api/subscriptions/upgrade` | POST | Upgrade/downgrade plan | Yes |
| `/api/subscriptions/cancel` | POST | Cancel subscription | Yes |

### Decision Tree

```
User wants to subscribe
  ├─ Has active subscription?
  │   ├─ Yes → Show upgrade/downgrade options
  │   └─ No → Show create subscription flow
  │
  ├─ Wants to change plan?
  │   ├─ Higher price → Upgrade (immediate or scheduled)
  │   └─ Lower price → Downgrade (always scheduled)
  │
  └─ Wants to cancel?
      ├─ Immediately → Lose access now
      └─ At period end → Keep access until end
```

---

**Need help?** Check the error codes section or contact support.
