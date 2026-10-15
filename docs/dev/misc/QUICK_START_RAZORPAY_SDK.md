# Quick Start: Razorpay SDK Integration

Get your subscription payment working in 5 minutes.

---

## 1. Add Razorpay Script (1 min)

Add to your `index.html`:

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

---

## 2. Set Environment Variable (1 min)

Add to your `.env`:

```bash
REACT_APP_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
```

Get your Key ID from: https://dashboard.razorpay.com/app/keys

---

## 3. Create Payment Component (3 min)

```javascript
// SubscribeButton.jsx
import React, { useState } from 'react';

const SubscribeButton = ({ planId, user, accessToken }) => {
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    try {
      setLoading(true);

      // Step 1: Create subscription
      const res = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ planId })
      });

      const data = await res.json();

      if (!data.success) {
        alert(data.message);
        return;
      }

      // Step 2: Open Razorpay popup
      const options = {
        key: process.env.REACT_APP_RAZORPAY_KEY_ID,
        subscription_id: data.subscription.razorpaySubscriptionId,
        name: 'Your Company',
        description: data.plan.name,
        
        handler: async function(response) {
          // Step 3: Verify payment
          const verifyRes = await fetch('/api/subscriptions/verify', {
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

          const verifyData = await verifyRes.json();
          
          if (verifyData.verified) {
            alert('✅ Subscription activated!');
            window.location.href = '/dashboard';
          } else {
            alert('❌ Payment verification failed');
          }
        },
        
        prefill: {
          name: user.name,
          email: user.email
        },
        
        modal: {
          ondismiss: () => setLoading(false)
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();

    } catch (error) {
      alert('Error: ' + error.message);
      setLoading(false);
    }
  };

  return (
    <button onClick={handleSubscribe} disabled={loading}>
      {loading ? 'Processing...' : 'Subscribe Now'}
    </button>
  );
};

export default SubscribeButton;
```

---

## 4. Use the Component

```javascript
// PricingPage.jsx
import SubscribeButton from './SubscribeButton';

function PricingPage() {
  const { user, accessToken } = useAuth();

  return (
    <div>
      <h1>Choose Your Plan</h1>
      
      <div className="plan">
        <h2>Pro Monthly</h2>
        <p>₹26/month</p>
        <SubscribeButton 
          planId="pro_monthly"
          user={user}
          accessToken={accessToken}
        />
      </div>

      <div className="plan">
        <h2>Max Monthly</h2>
        <p>₹88/month</p>
        <SubscribeButton 
          planId="max_monthly"
          user={user}
          accessToken={accessToken}
        />
      </div>
    </div>
  );
}
```

---

## 5. Test It

### Test Card Details
- **Card Number:** `4111 1111 1111 1111`
- **Expiry:** Any future date (e.g., `12/25`)
- **CVV:** Any 3 digits (e.g., `123`)
- **Name:** Any name

### Test Flow
1. Click "Subscribe Now"
2. Popup opens
3. Enter test card details
4. Click "Pay"
5. Success message appears
6. Redirected to dashboard

---

## That's It! 🎉

Your subscription payment is now working with Razorpay SDK.

### What Happens Next?

1. **User sees success** → Immediate feedback via `/verify` endpoint
2. **Webhook processes payment** → Records payment, grants credits (async)
3. **User gets access** → Subscription activated

### Need More?

- **Full Guide:** `FRONTEND_SUBSCRIPTION_API_GUIDE.md`
- **Quick Reference:** `SUBSCRIPTION_API_QUICK_REFERENCE.md`
- **Test File:** `RAZORPAY_SDK_EXAMPLE.html`

---

## Troubleshooting

### Popup doesn't open
- Check if Razorpay script is loaded
- Check browser console for errors
- Verify `REACT_APP_RAZORPAY_KEY_ID` is set

### Payment succeeds but verification fails
- Check if access token is valid
- Check backend logs
- Webhook will still process payment

### "User already has subscription" error
- User already subscribed
- Use `/upgrade` endpoint instead
- Check current subscription with `/current`

---

## Production Checklist

- [ ] Replace test Key ID with live Key ID
- [ ] Test with real card (small amount)
- [ ] Verify webhooks are working
- [ ] Add error tracking (Sentry, etc.)
- [ ] Add loading states
- [ ] Add success/error messages
- [ ] Test on mobile devices
- [ ] Test on different browsers

---

**Ready to go live?** Just replace `rzp_test_` with `rzp_live_` in your Key ID!
