# Jomobit Backend

Give me a nice backend template using nodejs. mongoDB. 
I will be using auth0 for 

1. identiy mangement. 
2. razorpay for payments. 
3. Different LLMS for prompt generation. for now GPT, gemini
4. Different diffusion models for now. Ideogram, GPT for generation. 
5. but can be extensible for future. 
6. image kit for images saving and delivering. 
7. give me first schema with best practices. 
8. Use best design patterns for making it scalable. 
9. Below is my all requirements. 
10. Also add if you find anything is missing. 

# Functional Requirements

1. Authorization: User signup, login, logout, login via socials, number verfication. 
2. A user is getting created: we will assign some credits to them. ~ 3 credits per user in the free plan. 
3. User can view the poster gallery.→ He will get alot of poster templates which he can use to fuse or blend them to create personalized AI posters. 
4. For fusin a poster he first needs to create a business profile. 
5. He has to enter all the business details like: Business name, tagline, color pallate, logo, description, products.
6. Depending on the plan we are allowing a user to create a certain number of Business profiles. 
7. Poster will be generated on the basis of the business profile they have choosen which they can alter from the settings. 
8. Plans: This platform will have 3 plans: 
    1. Free: 3 credits per month, 1 business profile, this can’t be changed.
    2. Plus: 50 credits per month, 3 business profiles. Pricing: 25usd / per month. 
    3. Pro: 120 credits per month, 8 business profiles. Pricing : 59usd / per month. 
9. User can select any plan monthly, Yearly. → can pay the price. It will automatically deducted amount and the user can enjoy out service. 
10. We are not allowing user to change the email or number. he can change the password via auth0. 
11. User can view the history of posters filtered via different accounts. 
12. User can upgrade their subscriptions and they wont be charged fully if they are upgrading the same month. eg: 25usd. 13th of month → upgrade → pro: 59 = 59-25 = 34usd pay only. 
13. user can download the poster share via : Instagram, whatsapp, facebook. 
14. user can report an issue via email. 

Admin Actions:

1. Admin can logged in via normal user but wont get any roles or permission in token automatically token or authentication. 
2. Admin can create plans for users. can edit plans. 
3. We willl manually assign it via auth0 Dashboard. 
4. Admin can view insights: total users, total templates, total posters created, total renvue. 
5. users details, users posters, 
6. admin can ban a user. 
7. Admin can view all payments , subscriptions, credit trasactions. 
8. Admin can add different templates directly via drag and drop or batch adding can also be done. 
9. Slack webhooks configured. can get resolved. 

# Non Functioal Requirements:

1. Images webhooks confiured so that we get don;t poll to the server. 
2. images will come via imagekit cdn. 
3. Should have demo UI being Loaded. 
4. will use auth0 for authentication
5. we will use razorpay for payments. 
6. for image generation we will use open AI , Ideogram, flux via relicate etc. Code it in way so that the design pattern looks great. 

# APIs:

## 1. Authorization Flow:

1. POST: /webhooks/auth0/user/sync: Verifies webhooks, recives a user object from auth0 checks if a user exits if yes saves it to database and send a true response if no moves forward.
2. POST: /webhooks/auth0/user/verify: verifies webhooks recives a status and user object finds and updates its status from pending to active and sends respective response.
use this latest lib for auth0:
const {
  auth,
  claimCheck,
  InsufficientScopeError,
} = require("express-oauth2-jwt-bearer");
const dotenv = require("dotenv");

dotenv.config();

const validateAccessToken = auth({
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`,
  audience: process.env.AUTH0_AUDIENCE,
});

const checkRequiredPermissions = (requiredPermissions) => {
  return (req, res, next) => {
    const permissionCheck = claimCheck((payload) => {
      const permissions = payload.permissions || [];

      const hasPermissions = requiredPermissions.every((requiredPermission) =>
        permissions.includes(requiredPermission)
      );

      if (!hasPermissions) {
        throw new InsufficientScopeError();
      }

      return hasPermissions;
    });

    permissionCheck(req, res, next);
  };
};

module.exports = {
  validateAccessToken,
  checkRequiredPermissions,
};


## 2. Profile Creation Flow:

1. POST: /user/profile: Permissions[create:profiles]: Takes information as 1. Names 2. logo 3. Slogan 4. description 5. product 6. address 7. color pallate 8. typography then checks is the profile has which active plan and accordingly number of profiles in a plan and then creates profiles. and returns a nice page for the business profile. 
2. GET: /user/profile: Permissions[get:Allprofiles]: Get the profiles name, id, image of all profiles. 
3. POST : /user/profile/Id: Permissions[update:profiles]: take the profile Id and only update SLOGAN, product, color pallate, typography. 
4. GET: /user/profile/Id: Permissions[get:oneProfile]: Get all the details of a single profile.

## 3. Template Viewing, Filtering & Searching Flow:

1. GET: /templates?search&filter&type&number: Permissions[get: all-Templates]: All the templates: id, images, aspect ratio in a paginated way. filter on the basis of tags. searching also but can be done later.
2. GET: /templates/filters: permissions[get:all-Filters]: All the templates: id, name. can use index for tags. 

## 3. Credits Transaction Flow & Services:

[Credit Transactions in Jomobit:](https://www.notion.so/Credit-Transactions-in-Jomobit-23af36ca1d2d801ca000d222c9a0c0ac?pvs=21)

## Core System Elements & Their Significance

### 1. **Credits System Foundation**

**What it is**: A virtual currency system where users consume credits to generate images.
**Why essential**: Provides monetization control, usage tracking, and resource management without direct payment processing for each operation.

### 2. **ACID Transactions in MongoDB**

**What it is**: Atomic, Consistent, Isolated, Durable operations that ensure data integrity.
**Why critical**: Without ACID properties, you could have:

- Race conditions (two simultaneous generations deducting credits incorrectly)
- Partial failures (credits deducted but image generation fails)
- Data inconsistency (user shows different credit balances across sessions)

### 3. **Event-Driven Architecture with Webhooks**

**What it is**: Third-party service notifies your system when image generation completes, rather than your system constantly checking.
**Why superior to polling**:

- Reduces server load (no constant API calls)
- Real-time updates (immediate notification vs delayed polling intervals)
- Cost-effective (pay per event vs continuous polling costs)

### 4. **Internal vs API Operations**

**Why internal operations**: Credit transactions are business-critical operations that should never be exposed to external manipulation. API endpoints could be exploited to artificially add credits.

## System Architecture Elements

### A. Core Entities

1. **User Account**
    - Unique identifier
    - Account creation timestamp
    - Subscription status
2. **Credit Wallet**
    - Current balance
    - Wallet type (default/subscription)
    - Expiration tracking
3. **Credit Transactions**
    - Transaction history
    - Operation type (credit/debit)
    - Reference tracking
    - Atomic operation logs
4. **Subscription Plans**
    - Plan tiers
    - Monthly credit allocation
    - Renewal cycles
5. **Image Generation Jobs**
    - Job tracking
    - Status management
    - Credit reservation system

### B. Transaction Types

1. **Initial Credit Grant**: One-time default credits on account creation
2. **Subscription Credits**: Monthly recurring credits based on plan
3. **Credit Consumption**: Deduction for image generation
4. **Credit Expiration**: Monthly cleanup of expired subscription credits
5. **Refund Credits**: Restoration when generation fails

## User Flow Scenarios

### Scenario 1: New User Registration

1. User creates account
2. System automatically grants default credits (e.g., 10 credits)
3. Credits are marked as "permanent" (no expiration)
4. User can immediately start generating images

### Scenario 2: Subscription Purchase

1. User subscribes to a plan (e.g., Pro Plan - 100 credits/month)
2. System immediately grants monthly credit allocation
3. These credits are marked with current month expiration
4. User's total balance = default credits + subscription credits

### Scenario 3: Image Generation Request

1. User initiates image generation
2. System checks available credits
3. **Pre-generation**: Credits are "reserved" (not yet deducted)
4. Generation job sent to third-party service
5. System waits for webhook notification
6. **On success**: Reserved credits are deducted, image delivered
7. **On failure**: Reserved credits are released back

### Scenario 4: Monthly Credit Renewal

1. Subscription renews automatically
2. System expires previous month's subscription credits
3. New month's credits are granted
4. Default credits remain untouched

### Scenario 5: Credit Expiration Flow

1. End of month batch job runs
2. Identifies expired subscription credits
3. Removes expired credits while preserving default credits
4. Updates user balances atomically

## Transaction Flow Deep Dive

### Credit Reservation System

**Why needed**: Prevents overselling credits when multiple generations happen simultaneously.

**How it works**:

1. User requests generation
2. System "reserves" required credits (marks as pending)
3. Available balance = total credits - reserved credits
4. On webhook success: reserved → deducted
5. On webhook failure: reserved → available

### ACID Transaction Example

`START TRANSACTION
1. Check user has sufficient available credits
2. Create generation job record
3. Reserve credits (update wallet)
4. Create transaction log entry
5. Send to third-party service
COMMIT/ROLLBACK based on success`

### Webhook Processing Flow

1. Third-party sends webhook to your endpoint
2. System validates webhook authenticity
3. Locates corresponding generation job
4. Updates job status
5. **Success path**: Deduct reserved credits, mark job complete
6. **Failure path**: Release reserved credits, mark job failed
7. Notify user of completion/failure

## Why This Architecture?

### Problem Without ACID Transactions:

- User has 5 credits
- Starts 3 simultaneous generations (each needs 2 credits)
- Without proper locking: all 3 might pass the "sufficient credits" check
- Result: User goes to -1 credits

### Problem Without Event-Driven Architecture:

- Polling every 5 seconds for 1000 active jobs = 12,000 API calls/minute
- Webhook approach = 1000 calls total (only when jobs complete)
- 99.2% reduction in API calls

### Problem With API-Based Credit Operations:

- Malicious users could call credit addition endpoints
- No proper audit trail for internal operations
- Security vulnerabilities in credit manipulation

## Service Responsibilities

1. **Credit Service**: Manages all credit operations, balance calculations, expiration logic
2. **Transaction Service**: Handles ACID operations, maintains audit trails
3. **Generation Service**: Manages image generation jobs, webhook processing
4. **Subscription Service**: Handles plan management, monthly renewals
5. **Notification Service**: Updates users on credit changes, generation completion

This architecture ensures data integrity, prevents credit fraud, optimizes third-party API usage, and provides a scalable foundation for your image generation platform.

Would you like me to elaborate on any specific aspect before we move to the technical implementation?

1. I am will be using a in app kind of credits system . These credits can be used by users in the platform for generating images.
2. By default they will get a certain number of credits which can be configurable. only one time per account. 
3. on subcribing to a plan they will get certain amount of credits each month. 
4. But these credits on a monthly bais will get expire on end of every month and new subscriptions when renewed will refresh the new credit to it. 
5. These credits will have its all basic information and reference information also and this is will follow a ACID transactions in mongoDB so that thier deduction addition can happen in a system flow not just increment and decrement. 
6. Also the generation of posters will happen via event driven architecutre using webhooks from thrid party to notify when generation is complete instead of polling so how will the system work in this case. these operations of credit transactions should happen interally not via API i think is it right? so give me a backend schema service for demonstrating this credit transaction flow. 

## 4. Poster Generations.

For poster generation code it so that I can use different LLMS, Difussion models. 

1. POST /poster/generate: Permissions[generate-posters]: Takes the business ID , and templatate ID and runs some services. for detailed extraction of prompt and then sends them to chatGPT OR Ideogram for generation and reserve some credits and create a poster with the neccesary details. the after the generation is complete process the webhooks and give gives me the image url of the poster then my storage block saves the image generation and then returns a reponse. 
2. GET /poster: Permissions[getall-posters]: Gives all the posters a user has generated. 
3. Get /poster/id: permissions[getone-poster]: gives the poster for the respected ID. 
4. POST /webhooks/poster/id: process the webhooks and saves the posters. 

## 5. Payment Flow API:

1.  POST: /webhooks/subsctiption: process the subscription and activates the payment. gives credits to the user. 
2. **User can upgrade plans:  
user can upgrade the subscription. on pop up he will get the revised pricing. have to pay for the current month then afterwards he can pay directly for the current plan. will get the upgraded credits**
3. **User  can cancel subscription:  
User can cancel a subscription and he wont be charged for it**
4. **User  can view billing History:  
User can view billing history in subscription which show amount taken via channel card, upi etc , date and on which plan.**