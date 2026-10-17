# Deploying jomobit-backend to a Fresh AWS Account

Rebuild of the `feature/scaling` → **staging** deployment, starting from a **new laptop** and a
**new AWS account**, with a `.env` received from a teammate.

**Target state:** EKS cluster `4-jomo-cluster` in `ap-south-1`, app in namespace `staging`,
monitoring in `monitoring-staging`, served at `https://api-dev.amritesh.dev`.

> **Why we reuse the exact same cluster name and region:** `.github/workflows/cicd.yml` hardcodes
> `--region ap-south-1 --name 4-jomo-cluster` in every `aws eks update-kubeconfig` step. Recreating
> with the same name/region means **no workflow changes at all**. If you want a different name or
> region, see [Appendix C](#appendix-c--changing-cluster-name-or-region).

---

## Table of Contents

| Phase | What | Time |
|---|---|---|
| [00](#phase-00--new-laptop-bootstrap) | New laptop bootstrap | 15 min |
| [01](#phase-01--aws-account--iam) | AWS account & IAM | 20 min |
| [02](#phase-02--preflight-verify-what-you-inherited) | Preflight: verify what you inherited | 15 min |
| [03](#phase-03--create-the-eks-cluster) | Create the EKS cluster | 20 min (mostly waiting) |
| [04](#phase-04--storageclass-gp2) | StorageClass `gp2` | 2 min |
| [05](#phase-05--metrics-server-required-for-hpa) | metrics-server | 2 min |
| [06](#phase-06--ingress-nginx-controller) | ingress-nginx controller | 5 min |
| [07](#phase-07--dns-on-amriteshdev) | DNS on amritesh.dev | 15 min + propagation |
| [08](#phase-08--mongodb-atlas-ip-allowlist) | MongoDB Atlas IP allowlist | 5 min |
| [09](#phase-09--iam-user-for-github-actions) | IAM user for GitHub Actions | 10 min |
| [10](#phase-10--github-secrets--environments) | GitHub secrets & environments | 20 min |
| [11](#phase-11--cert-manager-issuer-email) | cert-manager issuer email | 1 min |
| [12](#phase-12--deploy) | Deploy | 10 min |
| [13](#phase-13--verify) | Verify | 10 min |
| [14](#phase-14--post-deploy-wiring) | Post-deploy wiring | 30 min |

**Total: ~3.5 hours**, most of it waiting on cluster creation and DNS.

### The four hard orderings

Everything else can slip; these cannot. Each one caused a documented failure last time.

| This must happen | …before this | Or else |
|---|---|---|
| Admin IAM user + CLI profile (**01**) | any `aws`/`eksctl` command (**03**+) | nothing authenticates |
| EBS CSI driver + `gp2` (**03**, **04**) | monitoring PVCs bind | Prometheus/Grafana `Pending` forever |
| DNS resolves (**07**) | TLS certificate issues (**12**) | HTTP-01 challenge fails, Let's Encrypt rate-limits you |
| Atlas IP allowlist (**08**) | pods reach `Running` (**13**) | `CrashLoopBackOff` on Mongo connect |

---

## Phase 00 — New laptop bootstrap

**Verified on this machine:** `brew`, `git`, `kubectl`, `docker` (daemon running), `node`, `npm` are
already installed. **Missing:** `aws`, `eksctl`, `helm`, `gh`.

### 0.1 Homebrew

Already present here. On a truly bare Mac:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then follow the "Next steps" it prints to add `brew` to your `PATH` — on Apple Silicon that means
`eval "$(/opt/homebrew/bin/brew shellenv)"` in your `~/.zprofile`.

### 0.2 Install what's missing

```bash
brew install awscli eksctl helm gh
```

If `brew install eksctl` fails, use the official tap:

```bash
brew tap eksctl-io/eksctl && brew install eksctl-io/tap/eksctl
```

### 0.3 Docker must be running, not just installed

The CI builds the image, so you don't strictly need Docker for the deploy — but you do for any local
build or debugging. Confirm the daemon, not just the binary:

```bash
docker info > /dev/null 2>&1 && echo "daemon running" || echo "start Docker Desktop"
```

If it's not running, launch Docker Desktop and wait for the whale icon to settle.

### 0.4 Git identity and GitHub auth

You push to `feature/scaling` to trigger the deploy (Phase 12), so this has to work:

```bash
git config --global user.name  "Amritesh Indal"
git config --global user.email "AIndal@mgocpa.com"

gh auth login       # choose GitHub.com → SSH or HTTPS → browser
gh auth status
```

Confirm the clone is wired to the right remote and branch:

```bash
cd /Users/amriteshindal/Amritesh/JOMOBIT/jomobit-backend
git remote -v                # expect: git@github.com:looper12349/jomobit-backend.git
git branch --show-current    # expect: feature/scaling
git fetch origin && git status -sb
```

If you're not on `feature/scaling`:

```bash
git checkout feature/scaling
```

### 0.5 Verify everything

```bash
for t in brew git aws kubectl eksctl helm docker gh node npm; do
  printf "%-9s %s\n" "$t" "$(command -v $t || echo MISSING)"
done
```

All ten should resolve to a path before you continue.

---

## Phase 01 — AWS account & IAM

This is the first real gate: nothing else in this runbook works until you have a working IAM
identity and a configured CLI profile.

### 1.1 Secure the root account

In the AWS Console, signed in as root:

1. **Enable MFA on the root user** — IAM → Security credentials → Assign MFA device.
2. **Do not create access keys for root.** If the account came with any, delete them.
3. Set the account's alternate contacts and confirm the billing email is one you read.

### 1.2 Create your admin IAM user

IAM → Users → **Create user**:

- User name: `amritesh-admin`
- ✅ **Provide user access to the AWS Management Console** (so you have a non-root console login)
- Permissions → **Attach policies directly** → `AdministratorAccess`
- Create user, then **enable MFA on this user too**

#### What access does this user actually need?

`eksctl create cluster` is not a small permission ask. It creates a VPC, six subnets, route tables,
a NAT gateway, an internet gateway, security groups, the EKS control plane, a managed node group, an
IAM OIDC provider, several IAM roles with attached policies, and instance profiles — all through
CloudFormation.

**Recommendation: give this user `AdministratorAccess`.** It's your own account and you're
bootstrapping it from empty. Hand-crafting a least-privilege policy for `eksctl` is a well-known
time sink, and the usual failure mode is a half-created CloudFormation stack you then have to
unwind by hand.

**Spend your least-privilege effort where it actually pays: the CI user in [Phase 09](#phase-09--iam-user-for-github-actions),
which needs exactly one AWS permission.** That's the credential that lives forever in GitHub and
gets used unattended — it's the one worth scoping tightly.

If you still want this bootstrap user scoped, attach these managed policies:

| Policy | Covers |
|---|---|
| `AWSCloudFormationFullAccess` | eksctl drives everything through CFN stacks |
| `AmazonEC2FullAccess` | VPC, subnets, route tables, NAT/IGW, SGs, instances, volumes |
| `IAMFullAccess` | cluster/node roles, instance profiles, the OIDC provider |
| `AmazonEKSClusterPolicy` + inline `eks:*` | the EKS control plane and addons |
| inline `autoscaling:*`, `ssm:GetParameter` | managed node group; SSM is the EKS AMI lookup |

Be aware this set is still broad, and the `ssm:GetParameter` requirement in particular is easy to
miss — without it node group creation fails with an opaque AMI resolution error.

### 1.3 Create an access key and configure the CLI

On the new user: **Security credentials → Create access key → Command Line Interface (CLI)**.

```bash
aws configure --profile jomo
# AWS Access Key ID     : <the key you just created>
# AWS Secret Access Key : <the secret — shown only once>
# Default region name   : ap-south-1
# Default output format : json
```

Make it active for this shell. **Every command in this runbook assumes these two exports**, so
re-run them in any new terminal:

```bash
export AWS_PROFILE=jomo
export AWS_REGION=ap-south-1
```

Consider putting them in your `~/.zshrc` while this deploy is in progress.

### 1.4 Verify, and save your account ID

```bash
aws sts get-caller-identity
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account: $AWS_ACCOUNT_ID"
```

The ARN should read `arn:aws:iam::<account>:user/amritesh-admin` — **not** `:root`. You'll reuse
`$AWS_ACCOUNT_ID` in Phase 09.

### 1.5 Check service quotas

Brand-new AWS accounts ship with low limits that stall cluster creation with unhelpful errors.

```bash
# Elastic IPs — need >= 1 for the NAT gateway (default 5)
aws service-quotas get-service-quota \
  --service-code ec2 --quota-code L-0263D0A3 --region ap-south-1 \
  --query 'Quota.[QuotaName,Value]' --output text

# On-Demand Standard vCPUs — need >= 4 for two t3.medium
aws service-quotas get-service-quota \
  --service-code ec2 --quota-code L-1216C47A --region ap-south-1 \
  --query 'Quota.[QuotaName,Value]' --output text
```

If either is short, request an increase now in the Service Quotas console — approval can take hours,
so do it before you need it.

### 1.6 Set a budget alarm

This stack runs roughly **$190–230/month** ([Appendix A](#appendix-a--cost-breakdown)). Put the
guardrail up before the spend starts:

Billing → Budgets → Create budget → Cost budget → monthly $250 → email alert at 80% and 100%.

---

## Phase 02 — Preflight: verify what you inherited

Your `.env` came from a teammate and your Docker Hub / Atlas / GitHub access is unproven on this
machine. Fifteen minutes here saves an hour of debugging a half-deployed cluster.

### 2.1 Check the `.env` against the template

```bash
cd /Users/amriteshindal/Amritesh/JOMOBIT/jomobit-backend

comm -23 \
  <(grep -oE '^[A-Z0-9_]+=' .env.template | tr -d '=' | sort -u) \
  <(grep -oE '^[A-Z0-9_]+=' .env          | tr -d '=' | sort -u)
```

**Already run for you. Result — four keys in the template are absent from your `.env`:**

| Missing key | Verdict |
|---|---|
| `ALLOWED_ORIGINS` | ⚠️ **Must be fixed.** See 2.2. |
| `AWS_ACCESS_KEY_ID` | Fine — the app has no AWS SDK; see [Phase 10.3](#103--recommended-fix-stop-shipping-aws-creds-to-the-app) |
| `AWS_SECRET_ACCESS_KEY` | Fine — same reason |
| `AWS_REGION` | Fine — harmless either way |

The ImageKit keys are **real**, not placeholders — `public_` and `private_` are ImageKit's own key
prefixes.

### 2.2 ⚠️ `ALLOWED_ORIGINS` is missing and it will break CORS

`src/config/security.js:90` and `src/app.js:64` both do this:

```js
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001').split(',');
if (allowedOrigins.includes(origin)) { /* allow */ } else { /* block + log */ }
```

Two consequences if you leave it unset:

1. The fallback is **localhost only**, so every browser request from your real frontend is
   **CORS-blocked** on the deployed API. The pod stays healthy and `curl` works fine — this fails
   silently, in the browser only, which makes it a nasty one to chase.
2. `src/config/security.js:378` logs a startup warning in production. It's a warning, not a fatal —
   so nothing stops the deploy.

Set it in both places — your local `.env` and the `ALLOWED_ORIGINS` GitHub secret (Phase 10):

```bash
# Local .env — adjust to your actual frontend origin(s)
echo 'ALLOWED_ORIGINS=https://api-dev.amritesh.dev,http://localhost:8081' >> .env
```

**The match is exact string equality**, so:

- **No trailing slash.** `https://foo.com/` will not match `https://foo.com`.
- **Scheme must match.** `http://` and `https://` are different origins.
- **Port is part of the origin.** `localhost:8081` ≠ `localhost:3000`.
- **No spaces after the commas** — the value is `.split(',')` with no trimming, so
  `a, b` yields a literal `" b"` that never matches.

Include every browser origin that calls this API: your staging frontend, and `localhost:<port>` for
local development against staging.

### 2.3 Confirm Docker Hub push access

The workflow pushes to `ai29/jomo-backend`. Confirm you control that namespace — on a new account,
you may not.

```bash
docker login                     # username must own or have write access to `ai29`
docker pull ai29/jomo-backend:latest || echo "repo missing or private/no access"
```

Then create a Docker Hub **access token** (Account Settings → Personal access tokens) for
`DOCKERHUB_TOKEN` in Phase 10 — do not use your account password.

> If you don't control `ai29`, change `DOCKER_IMAGE` in `.github/workflows/cicd.yml` to a namespace
> you do own, e.g. `youruser/jomo-backend`. It appears once, in the `env:` block at the top.

### 2.4 Confirm MongoDB Atlas access

You'll need to edit the IP allowlist in Phase 08, which means a working Atlas login.

- Sign in at cloud.mongodb.com and confirm you can reach the project containing
  `jomobit.svtjsyk.mongodb.net`
- Confirm the cluster is **not paused** — free and shared tiers auto-pause after 60 days idle
- Confirm the database user in your `MONGODB_URI` still exists with a current password

If your teammate owns the Atlas project, get yourself invited as a Project Owner now rather than at
Phase 08.

### 2.5 Inventory the third-party credentials

Every secret in Phase 10 comes from your `.env` — but a `.env` from a teammate may hold *their* dev
keys. Decide per service whether you're sharing or rotating: Auth0, Razorpay, OpenAI, Gemini,
Ideogram, FAL, ImageKit, Slack, n8n. Rotating later is fine; knowing which ones are shared is not
optional.

---

## Phase 03 — Create the EKS cluster

### 3.1 Write the cluster config

```bash
cd /Users/amriteshindal/Amritesh/JOMOBIT/jomobit-backend
mkdir -p infra
cat > infra/cluster.yaml <<'EOF'
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: 4-jomo-cluster
  region: ap-south-1
  version: "1.31"

# API auth mode lets us grant the CI user cluster access via EKS Access Entries
# (Phase 09) instead of hand-editing the aws-auth ConfigMap.
accessConfig:
  authenticationMode: API_AND_CONFIG_MAP

iam:
  withOIDC: true

# aws-ebs-csi-driver is REQUIRED: without it the Prometheus/Grafana PVCs stay Pending forever.
addons:
  - name: vpc-cni
  - name: coredns
  - name: kube-proxy
  - name: aws-ebs-csi-driver
    wellKnownPolicies:
      ebsCSIController: true

managedNodeGroups:
  - name: ng-general
    instanceType: t3.medium
    desiredCapacity: 2
    minSize: 2
    maxSize: 4
    volumeSize: 30
    volumeType: gp3
    # Private nodes egress through a single NAT gateway = ONE stable public IP,
    # which is what makes the MongoDB Atlas allowlist in Phase 08 possible.
    privateNetworking: true
    labels:
      role: general
    tags:
      Project: jomobit
      Environment: shared
EOF
```

### 3.2 Create it

```bash
eksctl create cluster -f infra/cluster.yaml
```

This takes **15–20 minutes**. It creates a VPC, 3 public + 3 private subnets, one NAT gateway, the
EKS control plane, and the managed node group.

> **If it fails partway**, don't just re-run — you'll get a name conflict on the existing
> CloudFormation stack. Delete first: `eksctl delete cluster -f infra/cluster.yaml --wait`, then
> check the CloudFormation console for leftover `eksctl-4-jomo-cluster-*` stacks in
> `DELETE_FAILED`. Permission errors here usually trace back to a scoped-down Phase 1.2 user.

### 3.3 Verify

```bash
aws eks update-kubeconfig --region ap-south-1 --name 4-jomo-cluster
kubectl get nodes -o wide
kubectl get pods -A
```

You want **2 nodes `Ready`** and everything in `kube-system` `Running`.

---

## Phase 04 — StorageClass `gp2`

`k8s/monitoring/prometheus-pvc.yaml` and `grafana-pvc.yaml` both hardcode
`storageClassName: gp2`. Check whether EKS gave you one:

```bash
kubectl get storageclass
```

If a `gp2` class exists, skip to Phase 05. If it does **not** (or you'd rather use faster, cheaper
gp3 volumes), create one *named* `gp2` so the manifests keep working unchanged:

```bash
kubectl apply -f - <<'EOF'
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp2
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
reclaimPolicy: Delete
parameters:
  type: gp3
  encrypted: "true"
EOF
```

> If EKS already created a `gp2` class, it may not be marked default. Mark it:
> ```bash
> kubectl patch storageclass gp2 -p \
>   '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
> ```

Confirm the CSI driver is actually running (this is what previously caused the "PVCs Pending" issue
recorded in `TROUBLESHOOTING-PODS-PENDING.md`):

```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-ebs-csi-driver
```

---

## Phase 05 — metrics-server (required for HPA)

`k8s/hpa.yaml` scales on CPU utilization, which needs metrics-server. **EKS does not ship it**, and
nothing in this repo installs it — so this was almost certainly a gap in the old setup too.

> **Not on the critical path.** metrics-server is only needed by the HPA in Phase 14.1. The app
> deploy, ingress, TLS, and the whole monitoring stack work without it — Prometheus scrapes the
> app's own `/metrics` endpoint and never touches the Metrics API. If this phase fights you, move
> on to Phase 06 and come back.

### 5.1 Check whether something already installed it

Do this **before** applying anything. A pre-existing install makes `kubectl apply` of the upstream
manifest impossible to reconcile (see 5.4).

```bash
kubectl get deployment metrics-server -n kube-system 2>/dev/null && echo "ALREADY PRESENT — read 5.4 first"
helm list -A | grep -i metrics
aws eks list-addons --cluster-name 4-jomo-cluster --query 'addons' --output text
```

### 5.2 Preferred: the EKS managed addon

On EKS this is the cleanest option — AWS maintains the version and the kubelet wiring.

```bash
# Confirm it's offered for your cluster version
aws eks describe-addon-versions --addon-name metrics-server   --kubernetes-version 1.31   --query 'addons[].addonVersions[].addonVersion' --output text

aws eks create-addon --cluster-name 4-jomo-cluster --addon-name metrics-server
aws eks wait addon-active --cluster-name 4-jomo-cluster --addon-name metrics-server
```

### 5.3 Alternative: the upstream manifest, pinned

If the addon isn't available, apply a **pinned release**. Never use `/latest/download/` — an
unpinned URL means you can't reproduce what you installed, and it silently changes under you.

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml
kubectl -n kube-system rollout status deployment/metrics-server --timeout=120s
```

### 5.4 ⚠️ If a conflicting install already exists

Applying the upstream manifest over a metrics-server installed by Helm or as an EKS addon **fails
and cannot be forced**:

```
Warning: resource deployments/metrics-server is missing the
kubectl.kubernetes.io/last-applied-configuration annotation
The Deployment "metrics-server" is invalid:
* spec.template.spec.containers[0].ports[1].name: Duplicate value: "https"
* spec.selector: ... field is immutable
```

Read those two errors precisely:

- **`spec.selector` is immutable.** A Deployment's selector can never be patched. A Helm-installed
  metrics-server uses `app.kubernetes.io/instance` + `app.kubernetes.io/name` + `k8s-app`; upstream
  uses only `k8s-app`. They can't be merged.
- **Duplicate port name `https`.** Strategic-merge patch keys container ports by `containerPort`, so
  an existing port on a different number that's also named `https` merges into a second entry
  sharing one name.

A misleading detail: `deployment "metrics-server" successfully rolled out` may still print. That's
the *pre-existing* deployment reporting itself complete — the apply was rejected and nothing changed.

**Fix — pick one owner and remove the other.** If Helm owns it, uninstall through Helm:

```bash
helm uninstall <release-name> -n <namespace>
```

Otherwise delete the orphaned objects, then reinstall via 5.2 or 5.3:

```bash
kubectl delete apiservice v1beta1.metrics.k8s.io --ignore-not-found
kubectl delete deployment,service,serviceaccount metrics-server -n kube-system --ignore-not-found
kubectl delete clusterrole system:aggregated-metrics-reader system:metrics-server --ignore-not-found
kubectl delete clusterrolebinding metrics-server:system:auth-delegator system:metrics-server --ignore-not-found
kubectl delete rolebinding metrics-server-auth-reader -n kube-system --ignore-not-found
```

### 5.5 Verify

```bash
kubectl top nodes
```

`error: Metrics API not available` means the aggregated API isn't serving. Find out why:

```bash
kubectl get apiservice v1beta1.metrics.k8s.io   -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}: {.message}{"\n"}{end}'

kubectl get pods -n kube-system | grep metrics-server
kubectl logs -n kube-system -l k8s-app=metrics-server --tail=40
```

If the logs show `x509` or certificate errors, metrics-server is rejecting the kubelet's serving
cert. Add the insecure-TLS flag — **only** if you actually see those errors:

```bash
kubectl patch deployment metrics-server -n kube-system --type=json   -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl -n kube-system rollout status deployment/metrics-server --timeout=120s
```

Give it 30–60 seconds after the pod is ready — `kubectl top nodes` needs one scrape interval before
it returns numbers.

---

## Phase 06 — ingress-nginx controller

Every ingress in `k8s/` sets `ingressClassName: nginx`, and cert-manager's HTTP-01 solver is
configured for `class: nginx`. Nothing works without this controller.

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-type"=nlb \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-scheme"=internet-facing \
  --set controller.config.use-forwarded-headers="true" \
  --set controller.config.proxy-body-size=10m \
  --wait --timeout 10m
```

> **Why `use-forwarded-headers=true`:** the app calls `this.app.set('trust proxy', 1)`
> (`src/app.js:38`) and rate-limits per client IP. Without forwarded headers every request looks
> like it comes from the load balancer and rate limiting collapses onto one bucket.

### Get the load balancer hostname

```bash
export LB_HOST=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "LB: $LB_HOST"
```

Wait 2–3 minutes and retry if it comes back empty.

---

## Phase 07 — DNS on amritesh.dev

Two jobs here: repoint the repo's manifests at your new domain, then create the DNS record. Both
must be done before Phase 12, because cert-manager can't issue a certificate for a host that
doesn't resolve.

### 7.1 Pick the hostnames

Mirroring the repo's existing staging/production split:

| Environment | Hostname | Manifest |
|---|---|---|
| staging | `api-dev.amritesh.dev` | `k8s/staging-ingress.yaml` |
| production | `api.amritesh.dev` | `k8s/production-ingress.yaml` |

Substitute your own subdomains below if you prefer — they appear in exactly the places listed in
7.2, nowhere else.

### 7.2 Point the manifests at your domain

**These three files are the ones CI actually applies.** Everything else in `k8s/` with a hostname in
it is legacy and never reaches the cluster:

```bash
cd /Users/amriteshindal/Amritesh/JOMOBIT/jomobit-backend

# 1. Staging ingress — host + TLS SAN
sed -i '' 's/api-dev-jomo\.dazzeldigital\.com/api-dev.amritesh.dev/g' k8s/staging-ingress.yaml

# 2. Production ingress — host + TLS SAN
sed -i '' 's/api\.jomo\.dazzeldigital\.com/api.amritesh.dev/g' k8s/production-ingress.yaml

# 3. The URLs the workflow prints at the end of a deploy (cosmetic, but keep them honest)
sed -i '' 's/api-dev-jomo\.dazzeldigital\.com/api-dev.amritesh.dev/g;
           s/api\.jomo\.dazzeldigital\.com/api.amritesh.dev/g' .github/workflows/cicd.yml
```

**Also required for `.dev`** — flip the staging redirect (see 7.4 for why):

```bash
sed -i '' 's/ssl-redirect: "false"/ssl-redirect: "true"/' k8s/staging-ingress.yaml
```

`k8s/production-ingress.yaml` already has `ssl-redirect: "true"`.

#### Optional: the legacy files

Not applied by CI — `k8s/ingress.yaml`, `k8s/ingress-staging-combined.yaml`,
`k8s/monitoring/ingress-staging.yaml`, `k8s/monitoring/ingress-prod.yaml`, `k8s/configmap.yaml`,
`k8s/secrets.yaml`. Update them so nobody applies a stale host by hand later:

```bash
sed -i '' 's/api-dev-jomo\.dazzeldigital\.com/api-dev.amritesh.dev/g;
           s/api\.jomo\.dazzeldigital\.com/api.amritesh.dev/g;
           s/jomo\.dazzeldigital\.com/jomo.amritesh.dev/g' \
  k8s/ingress.yaml k8s/ingress-staging-combined.yaml \
  k8s/monitoring/ingress-staging.yaml k8s/monitoring/ingress-prod.yaml \
  k8s/configmap.yaml k8s/secrets.yaml .env.template
```

Confirm nothing essential is left behind:

```bash
grep -rn "dazzeldigital" k8s/ .github/ .env.template
```

Only `k8s/cert-manager-issuer.yaml` should still match — that's the Let's Encrypt contact address,
handled in Phase 11.

> ⚠️ **Do not change `AUTH0_AUDIENCE` to match the new domain.** It is an opaque API *identifier* in
> Auth0, not a URL that anything fetches. Changing it here without changing the API Identifier in
> the Auth0 dashboard breaks every token immediately. Leave it exactly as your `.env` has it.

### 7.3 Create the DNS record

Pick the option that matches where you want DNS to live.

> **Checked for you:** `amritesh.dev` is registered at **Name.com** and its nameservers are already
> live there (`ns1kpv.name.com`, `ns2fln.name.com`, `ns3fgh.name.com`, `ns4kmw.name.com`).
> `api-dev.amritesh.dev` does not resolve yet. That means **Option A is your fast path** — no
> nameserver change, no delegation wait, no extra cost.

#### Option A — Name.com, where your DNS already lives *(recommended)*

Because the domain's nameservers already point at Name.com and are serving, you only need to add one
record. Propagation is just the record's TTL — minutes, not days.

1. Sign in at name.com → **My Domains** → `amritesh.dev` → **DNS Records**
2. **Add Record**, using Name.com's field names:

| Field | Value |
|---|---|
| Type | `CNAME` |
| Host | `api-dev` |
| Answer | your `$LB_HOST` (the full `...elb.ap-south-1.amazonaws.com` hostname) |
| TTL | `300` |

3. Save.

Print the value to paste into "Answer":

```bash
echo $LB_HOST
# empty? re-export it from Phase 06:
export LB_HOST=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo $LB_HOST
```

> Enter only `api-dev` in the Host field, not the full `api-dev.amritesh.dev` — Name.com appends the
> domain for you. Entering the full name creates `api-dev.amritesh.dev.amritesh.dev`.

#### Option B — Route 53, if you want AWS-managed DNS

Only worth it if you want the whole zone under AWS (CLI management, ALIAS records, Terraform later).
It costs **$0.50/month** and requires changing nameservers at Name.com, which reintroduces a
delegation wait.

```bash
aws route53 create-hosted-zone \
  --name amritesh.dev \
  --caller-reference "amritesh-dev-$(date +%s)" \
  --hosted-zone-config Comment="jomobit API"

export HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name amritesh.dev --query 'HostedZones[0].Id' --output text | cut -d/ -f3)

# The four nameservers to set at Name.com, replacing the ns*.name.com ones
aws route53 get-hosted-zone --id $HOSTED_ZONE_ID \
  --query 'DelegationSet.NameServers' --output table
```

Set those four at Name.com (**My Domains → amritesh.dev → Nameservers**), wait for
`dig +short NS amritesh.dev` to return them, then add the record. An ALIAS A-record beats a CNAME —
no extra lookup, and it works at a zone apex:

```bash
# ZVDDDACTLDPK0 is the NLB hosted-zone ID for ap-south-1
aws route53 change-resource-record-sets --hosted-zone-id $HOSTED_ZONE_ID --change-batch "{
  \"Changes\": [{
    \"Action\": \"UPSERT\",
    \"ResourceRecordSet\": {
      \"Name\": \"api-dev.amritesh.dev\",
      \"Type\": \"A\",
      \"AliasTarget\": {
        \"HostedZoneId\": \"ZVDDDACTLDPK0\",
        \"DNSName\": \"dualstack.$LB_HOST\",
        \"EvaluateTargetHealth\": true
      }
    }
  }]
}"
```

> **Don't half-migrate.** If you create the Route 53 zone but leave the Name.com nameservers in
> place, the zone is ignored and your records do nothing. Either switch the nameservers or use
> Option A — not both.

#### Option C — Cloudflare

If you move the domain onto Cloudflare DNS, it has one setting that will silently break things.

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name | `api-dev` |
| Target | your `$LB_HOST` |
| Proxy status | **DNS only (grey cloud)** — *not* proxied |
| TTL | Auto |

> ⚠️ **Turn the orange cloud off.** With Cloudflare proxying enabled, Cloudflare terminates TLS and
> serves *its* certificate, so cert-manager's certificate never gets used and Let's Encrypt's
> HTTP-01 challenge may be intercepted. You would also need Cloudflare's SSL mode set to Full
> (strict) against an origin certificate you don't have yet. Grey cloud keeps the path direct to
> your NLB and lets cert-manager do its job.

### 7.4 `.dev` is HSTS-preloaded — what that changes

This is the one thing genuinely specific to your new domain. **Google owns `.dev` and submitted the
entire TLD to the HSTS preload list**, which every major browser ships. Three consequences:

1. **Browsers refuse plain HTTP to any `.dev` host.** They rewrite `http://` to `https://` before a
   request leaves the machine. That's why `ssl-redirect: "false"` in the staging ingress is
   pointless on this domain — nothing will ever arrive over HTTP from a browser. Set it to `"true"`
   (7.2) so the redirect is at least consistent for non-browser clients.

2. **Let's Encrypt HTTP-01 still works.** This is the part people panic about. The ACME validator is
   not a browser, does not consult the preload list, and reaches
   `http://api-dev.amritesh.dev/.well-known/acme-challenge/...` on port 80 normally. It also follows
   redirects to HTTPS and accepts an invalid certificate during validation, so `ssl-redirect: "true"`
   is safe. **Do not switch to a DNS-01 solver** — nothing here requires it.

3. **Don't test in a browser before the certificate exists.** A browser hitting
   `http://api-dev.amritesh.dev` gets force-upgraded to HTTPS, finds no valid certificate yet, and
   shows a TLS error. That looks like broken DNS but isn't. **Use `curl` for pre-certificate
   checks** — it ignores the preload list.

### 7.5 Verify

```bash
# Nameserver delegation actually took effect (new domains only)
dig +short NS amritesh.dev

# The record resolves to your load balancer
dig +short api-dev.amritesh.dev

# curl, NOT a browser — see 7.4
curl -I http://api-dev.amritesh.dev/api
```

You should get a `404` from nginx. That means DNS resolves and the controller is answering — there's
no backend yet, so 404 is the correct, expected result.

> **Timing depends on the option you took.** With **Option A** the nameservers are already live, so
> you're only waiting on the record's 300s TTL — usually under a minute. With **Option B or C** you
> changed nameservers, and delegation can take minutes to 24–48 hours; `dig +short NS amritesh.dev`
> returning the new nameservers is the signal it's live.
>
> **Either way, wait for `dig +short api-dev.amritesh.dev` to return your load balancer before
> Phase 12** — Let's Encrypt rate-limits failed validations, so a premature deploy costs you time
> you can't get back.

---

## Phase 08 — MongoDB Atlas IP allowlist

**This is the step most likely to be forgotten and the one that will make pods crash-loop.**

MongoDB is Atlas-hosted (`jomobit.svtjsyk.mongodb.net`), so your data survived the old AWS account
— but Atlas still allowlists the *old* account's egress IPs, which no longer exist.

### 8.1 Get the new NAT gateway's public IP

```bash
export VPC_ID=$(aws eks describe-cluster --name 4-jomo-cluster \
  --query 'cluster.resourcesVpcConfig.vpcId' --output text)

aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=$VPC_ID" "Name=state,Values=available" \
  --query 'NatGateways[].NatGatewayAddresses[].PublicIp' --output text
```

### 8.2 Add it in Atlas

1. https://cloud.mongodb.com → your project → **Network Access** → **IP Access List**
2. **Add IP Address** → enter `<NAT_IP>/32`, comment `EKS 4-jomo-cluster ap-south-1`
3. Delete the stale entries from the dead AWS account

### 8.3 Also confirm

- The Atlas cluster is still running (not paused — free/shared tiers auto-pause after 60 days idle)
- The database user in your `MONGODB_URI` still exists and the password is current

> **Note:** `REDIS_URL` in `.env` points at `redis://localhost:6379`, but Redis is **not required** —
> `redisConnection.connect()` is commented out in `connectDatabases()` (`src/app.js:321`). You do
> not need ElastiCache or an in-cluster Redis. Set the `REDIS_URL` GitHub secret to any placeholder.

---

## Phase 09 — IAM user for GitHub Actions

**This is the credential worth scoping tightly** — unlike your interactive admin user from Phase
1.2, this one lives in GitHub forever and runs unattended.

The workflow authenticates with a static access key
(`aws-actions/configure-aws-credentials@v4` + `secrets.AWS_ACCESS_KEY_ID`).

### 9.1 Create the user and a minimal policy

```bash
aws iam create-user --user-name github-actions-jomo

cat > /tmp/gha-eks-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["eks:DescribeCluster"],
    "Resource": "arn:aws:eks:ap-south-1:${AWS_ACCOUNT_ID}:cluster/4-jomo-cluster"
  }]
}
EOF

aws iam put-user-policy --user-name github-actions-jomo \
  --policy-name eks-describe-cluster \
  --policy-document file:///tmp/gha-eks-policy.json

aws iam create-access-key --user-name github-actions-jomo
```

**Copy the `AccessKeyId` and `SecretAccessKey` from that output now** — the secret is shown once.

> `eks:DescribeCluster` on one cluster ARN is all the *AWS* permission needed. It lets
> `update-kubeconfig` build a kubeconfig; everything after that is Kubernetes RBAC, granted next.

### 9.2 Grant Kubernetes access via an EKS Access Entry

```bash
export GHA_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:user/github-actions-jomo"

aws eks create-access-entry \
  --cluster-name 4-jomo-cluster \
  --principal-arn "$GHA_ARN" \
  --type STANDARD

aws eks associate-access-policy \
  --cluster-name 4-jomo-cluster \
  --principal-arn "$GHA_ARN" \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster
```

Cluster-admin *inside Kubernetes* is needed because the monitoring job installs cert-manager,
ClusterIssuers, and ClusterRoles. Verify:

```bash
aws eks list-access-entries --cluster-name 4-jomo-cluster
```

> **Worth knowing:** this static-key approach can be replaced with GitHub OIDC, which issues
> short-lived credentials and removes the long-lived secret from GitHub entirely. It means adding an
> IAM role with a trust policy for `token.actions.githubusercontent.com` and swapping the workflow's
> `aws-access-key-id` inputs for `role-to-assume`. Better posture, but it's a workflow change — out
> of scope for getting this deployed today.

---

## Phase 10 — GitHub secrets & environments

### 10.1 Create the environments

The `deploy` job declares `environment: name: staging|production`. Create both:

**Settings → Environments → New environment** → `staging`, then `production`.
(Optionally add a required reviewer on `production`.)

### 10.2 Add the repository secrets

**Settings → Secrets and variables → Actions → New repository secret.**

Every value below is read by `.github/workflows/cicd.yml`. Anything not marked 🆕 can be copied
from the `.env` your teammate sent — but see [Phase 2.5](#25-inventory-the-third-party-credentials)
about which of those you may want to rotate rather than reuse.

**AWS & registry** — these are the ones that must change:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | 🆕 from Phase 9.1 (the **CI** user, not your admin user) |
| `AWS_SECRET_ACCESS_KEY` | 🆕 from Phase 9.1 |
| `AWS_REGION` | `ap-south-1` |
| `DOCKERHUB_USERNAME` | 🆕 your Docker Hub user (Phase 2.3) |
| `DOCKERHUB_TOKEN` | 🆕 Docker Hub **access token**, not your password |

**App config:**

| Secret | Suggested staging value |
|---|---|
| `FRONTEND_URL` | your staging frontend URL |
| `ALLOWED_ORIGINS` | 🆕 **absent from your `.env`** — see [Phase 2.2](#22--allowed_origins-is-missing-and-it-will-break-cors) |
| `LOG_LEVEL` | `info` |
| `MONGODB_URI` | from `.env` (Atlas) |
| `REDIS_URL` | `redis://localhost:6379` (unused — see Phase 08 note) |

**Auth0:** `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`,
`AUTH0_WEBHOOK_SECRET`, `AUTH0_ACTIONS_SECRET`

**Razorpay:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`

**Credits:** `DEFAULT_USER_CREDITS` (`3`), `SUBSCRIPTION_RECONCILIATION_ENABLED` (`true`)

**AI providers:** `OPENAI_API_KEY`, `GEMINI_API_KEY`, `IDEOGRAM_API_KEY`, `FAL_KEY`

**ImageKit:** `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`

**Webhooks:** `SLACK_WEBHOOK_URL`, `N8N_WEBHOOK_URL`, `N8N_JWT_SECRET`, `N8N_REQUEST_KEY`,
`N8N_GENERATION_FLOW_ID`, `N8N_ENHANCEMENT_FLOW_ID`

**Monitoring:** `GRAFANA_ADMIN_PASSWORD` (a strong password — defaults to `admin123` if unset)

Fast path, now that you have `gh` from Phase 0.2:

```bash
gh secret set AWS_ACCESS_KEY_ID      --body "AKIA..."
gh secret set AWS_SECRET_ACCESS_KEY  --body "..."
gh secret set AWS_REGION             --body "ap-south-1"
gh secret set ALLOWED_ORIGINS        --body "https://api-dev.amritesh.dev,http://localhost:8081"
gh secret set GRAFANA_ADMIN_PASSWORD --body "$(openssl rand -base64 24)"
# ...and so on. Verify nothing is missing:
gh secret list
```

You can also bulk-load the non-AWS ones straight from `.env`, skipping comments and blanks:

```bash
# Review before running — this pushes every key in .env to GitHub
grep -E '^[A-Z0-9_]+=' .env | grep -vE '^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|NODE_ENV|PORT)=' \
  | while IFS='=' read -r k v; do
      [ -n "$v" ] && gh secret set "$k" --body "$v" && echo "set $k"
    done
```

### 10.3 ⚠️ Recommended fix: stop shipping AWS creds to the app

The workflow injects the *deploy* credentials into the application's runtime secret:

```yaml
--from-literal=AWS_ACCESS_KEY_ID="${{ secrets.AWS_ACCESS_KEY_ID }}" \
--from-literal=AWS_SECRET_ACCESS_KEY="${{ secrets.AWS_SECRET_ACCESS_KEY }}" \
```

**The app never uses them** — there is no `aws-sdk` or `@aws-sdk` dependency in `package.json` and
no AWS client anywhere in `src/`. This hands every backend pod (and anyone who can `kubectl exec`
into one, or read a leaked log) credentials that are cluster-admin on your EKS cluster.

Note this is also why the three `AWS_*` keys missing from your `.env` (Phase 2.1) don't matter.

Delete those two lines from the "Create/Update K8s Secret" step in
`.github/workflows/cicd.yml`. `AWS_REGION` is harmless and can stay.

I have not made this change — it's your call.

---

## Phase 11 — cert-manager issuer email

`k8s/cert-manager-issuer.yaml` uses `admin@dazzeldigital.com` for Let's Encrypt expiry notices, with
a `# Change this to your email` comment still in place. On a fresh account you may not control that
mailbox — and it's where certificate-expiry warnings land.

```bash
sed -i '' 's|admin@dazzeldigital.com|your-real@email.com|' k8s/cert-manager-issuer.yaml
```

cert-manager itself is installed automatically by the `deploy-monitoring` job — no action needed.

---

## Phase 12 — Deploy

Two options. **Option A is recommended** for the first deploy.

### Option A — push to `feature/scaling` (auto-deploys to staging)

The workflow triggers on pushes to `feature/scaling` and routes them to the `staging` namespace with
image tag `feature-scaling-<short-sha>`.

```bash
cd /Users/amriteshindal/Amritesh/JOMOBIT/jomobit-backend
git add infra/cluster.yaml DEPLOY-FRESH-AWS.md DEPLOY-FRESH-AWS.html k8s/cert-manager-issuer.yaml
git commit -m "chore: add fresh-AWS cluster config and deployment runbook"
git push origin feature/scaling
```

> **Do not commit `.env`.** Confirm it's ignored before you push: `git check-ignore -v .env`
> should print a matching rule from `.gitignore`. If it prints nothing, stop and add it.

If you have nothing to commit, trigger with an empty commit:

```bash
git commit --allow-empty -m "chore: redeploy to fresh AWS account"
git push origin feature/scaling
```

### Option B — manual dispatch

**Actions → CI/CD Pipeline - JOMO Backend (Kubernetes) → Run workflow**

- environment: `staging`
- action: `deploy`
- image_tag: **always fill this in explicitly**

> ⚠️ **Dispatch pitfall:** if you leave `image_tag` blank the workflow falls back to `latest`
> (`[ -z "$IMAGE_TAG" ] && IMAGE_TAG="latest"`). But `latest` is only ever tagged on the **default
> branch** (`type=raw,value=latest,enable={{is_default_branch}}`). On a fresh Docker Hub repo it
> won't exist and the pods will `ImagePullBackOff`. Pass a real tag like `feature-scaling-c967026`.

### Watch it

```bash
gh run watch
# or: gh run list --limit 3
```

Three jobs run in sequence: **Build and Push Docker Image** → **Deploy to Kubernetes** →
**Deploy Monitoring Stack**. The monitoring job takes the longest on a fresh cluster because it
installs cert-manager from scratch.

---

## Phase 13 — Verify

### 13.1 Application pods

```bash
kubectl get pods -n staging -o wide
kubectl rollout status deployment/jomo-backend -n staging
kubectl logs -n staging -l app=jomo-backend --tail=50
```

You want `2/2 Running`. Look for `Server running on port 3000` and
`All database connections established` in the logs.

**If pods are `CrashLoopBackOff`,** the cause is almost always the Atlas allowlist (Phase 08):

```bash
kubectl logs -n staging -l app=jomo-backend --tail=100 | grep -i "mongo\|database\|ECONN"
```

### 13.2 Monitoring stack

```bash
kubectl get pods -n monitoring-staging
kubectl get pvc -n monitoring-staging     # both must be Bound, not Pending
```

`Pending` PVCs mean Phase 04 or the EBS CSI driver needs another look.

### 13.3 Ingress and TLS

```bash
kubectl get ingress -n staging
kubectl get certificate -n staging
```

Wait for the certificate to reach `READY=True` — typically 1–3 minutes. If it doesn't:

```bash
kubectl describe certificate staging-tls -n staging
kubectl get challenges -n staging
kubectl describe challenge -n staging
```

A stuck challenge means DNS isn't pointing at the load balancer yet (recheck Phase 07).

### 13.4 End-to-end

```bash
# API route listing — the clearest proof the backend is reachable
curl -s https://api-dev.amritesh.dev/api | head -40

# Prometheus metrics
curl -s https://api-dev.amritesh.dev/metrics | head -20

# Monitoring UIs (open in a browser)
open https://api-dev.amritesh.dev/grafana/
open https://api-dev.amritesh.dev/prometheus/
```

Grafana login: `admin` / your `GRAFANA_ADMIN_PASSWORD`.

### 13.5 CORS actually works

Because `ALLOWED_ORIGINS` was missing (Phase 2.2), verify it explicitly rather than assuming. A
preflight from an allowed origin should return `access-control-allow-origin`:

```bash
curl -s -I -X OPTIONS https://api-dev.amritesh.dev/api/plans \
  -H "Origin: https://api-dev.amritesh.dev" \
  -H "Access-Control-Request-Method: GET" | grep -i "access-control-allow-origin" \
  || echo "NO CORS HEADER — check the ALLOWED_ORIGINS secret"
```

Swap in your real frontend origin. A blocked origin is logged by the pod, so cross-check:

```bash
kubectl logs -n staging -l app=jomo-backend --tail=100 | grep -i "cors"
```

> **Note on `/health`:** `k8s/staging-ingress.yaml` only exposes `/api`, `/metrics`, `/grafana`, and
> `/prometheus`. `/health` is **not** routed externally — it exists solely for the kubelet's
> liveness/readiness probes. `curl https://api-dev.amritesh.dev/health` returns 404, and
> that is correct. To hit it directly:
> ```bash
> kubectl port-forward -n staging deploy/jomo-backend 3000:3000
> curl http://localhost:3000/health
> ```

### 13.6 Prometheus is actually scraping

```bash
kubectl port-forward -n monitoring-staging svc/prometheus 9090:9090
```

Open http://localhost:9090/prometheus/targets — the `jomo-backend-staging` job should be **UP**.
Then http://localhost:9090/prometheus/alerts should list 4 rules. Note the `/prometheus` prefix: the
deployment sets `--web.route-prefix=/prometheus`.

---

## Phase 14 — Post-deploy wiring

### 14.1 Apply the HPA (not in CI)

`k8s/hpa.yaml` has no namespace and isn't applied by the workflow. Apply it manually now that
metrics-server exists (Phase 05):

```bash
kubectl apply -f k8s/hpa.yaml -n staging
kubectl get hpa -n staging
```

The `TARGETS` column must show a real percentage, not `<unknown>`.

### 14.2 Import the Grafana dashboard

Grafana → Dashboards → New → Import → Upload JSON file →
`monitoring/grafana/dashboards/jomobit-overview.json` → select the `Prometheus` datasource → Import.

### 14.3 Update third-party services to the new domain

| Service | What to update |
|---|---|
| **Auth0** | Allowed Callback/Logout/Web Origins; API Identifier must match `AUTH0_AUDIENCE` |
| **Razorpay** | Webhook URL → `https://api-dev.amritesh.dev/api/webhooks/razorpay` |
| **n8n** | Any callback URLs pointing at the old backend |
| **Frontend** | `jomobit-frontend` API base URL → `https://api-dev.amritesh.dev` |

Verified against `src/routes/webhooks.js`: Razorpay is `POST /api/webhooks/razorpay`; Auth0 uses
`/api/webhooks/auth0`, `/api/webhooks/auth0/user-registration`, `/api/webhooks/auth0/user-login`,
`/api/webhooks/auth0/user-update`, `/api/webhooks/auth0/user-deletion`.

Whatever frontend origin you settle on here must also be in `ALLOWED_ORIGINS` (Phase 2.2).

### 14.4 Optional: network policy

```bash
kubectl apply -f k8s/network-policy.yaml -n staging
```

Read it first — EKS's default VPC CNI does **not** enforce NetworkPolicy unless network policy
support is explicitly enabled on the `vpc-cni` addon, so this may be a silent no-op.

---

## Going to production later

The workflow deploys `main` → `production` namespace + `monitoring-prod`, at
`api.amritesh.dev`. To light that up:

1. Add DNS for `api.amritesh.dev` → the same `$LB_HOST` (Phase 07 again).
2. Set production values for the same secret names (GitHub Environment secrets on `production`
   override repository secrets — use that to separate prod from staging config). Give
   `ALLOWED_ORIGINS` its own production value.
3. Merge to `main`, or dispatch with `environment: production` and an explicit `image_tag`.

Everything from Phases 00–09 is shared account/cluster infrastructure — you don't repeat it.

---

## Rollback

```bash
# Fast: revert to the previous ReplicaSet
kubectl rollout undo deployment/jomo-backend -n staging
kubectl rollout status deployment/jomo-backend -n staging
```

Or **Actions → Run workflow → action: `rollback`, environment: `staging`**.

---

## Appendix A — Cost breakdown

Rough monthly, `ap-south-1`:

| Item | ~USD/month |
|---|---|
| EKS control plane | $73 |
| 2 × t3.medium nodes | $65 |
| NAT gateway (hourly + modest data) | $35 |
| Network Load Balancer | $18 |
| EBS: 2 × 30Gi node volumes | $6 |
| EBS: Prometheus 10Gi + Grafana 5Gi | $2 |
| Route 53 hosted zone — *only if Phase 7.3 Option B* | $0.50 |
| **Total (staging only)** | **~$199** |

Adding production doubles the PVCs and adds a second monitoring stack — budget ~$230–250 total,
since the cluster, nodes, NAT, and load balancer are shared.

**Ways to cut it:**
- Single node (`desiredCapacity: 1`, `minSize: 1`) → saves ~$32, but the 2-replica deployment loses
  its availability guarantee.
- `privateNetworking: false` → drops the NAT gateway (~$35), **but** node IPs become ephemeral and
  the Atlas allowlist stops working reliably. Not recommended.
- Prometheus retention is `30d` on a 10Gi volume; drop to `7d` and 5Gi if space is tight.

New AWS accounts get 12 months of limited free tier, but **note that EKS control plane hours and
NAT gateway hours are not free-tier eligible** — the $73 + $35 starts on day one.

---

## Appendix B — What broke last time (from repo history)

The repo carries a stack of fix-it notes from the previous deployment. These are the recurring
causes, all now handled proactively above:

| Symptom | Root cause | Handled in |
|---|---|---|
| `TROUBLESHOOTING-PODS-PENDING.md` — monitoring PVCs Pending | No EBS CSI driver / no `gp2` StorageClass | Phases 03, 04 |
| `FIX-404-ISSUE.md`, `TROUBLESHOOT-URL-ACCESS.md` | Ingress paths + missing/misrouted controller | Phase 06 |
| `DNS-UPDATE-REQUIRED.md`, `UPDATE-DNS-NOW.md` | DNS pointed at an old load balancer | Phase 07 |
| `METRICS-ENDPOINT-FIX.md` | `/metrics` path routing | already fixed in `staging-ingress.yaml` |

Once this deploy is green, those files are stale — worth deleting to stop them misleading future
you.

---

## Appendix C — Changing cluster name or region

If you don't want `4-jomo-cluster` / `ap-south-1`, you must edit `.github/workflows/cicd.yml` in
several places — three `update-kubeconfig` calls in the `deploy`, `deploy-monitoring`, and
`rollback` jobs, plus three `aws-region:` values:

```bash
# Preview the lines you'd need to change
grep -n "ap-south-1\|4-jomo-cluster" .github/workflows/cicd.yml
```

Then apply:

```bash
sed -i '' 's/4-jomo-cluster/YOUR-CLUSTER/g; s/ap-south-1/YOUR-REGION/g' \
  .github/workflows/cicd.yml infra/cluster.yaml
```

Also update the region in the Phase 9.1 IAM policy ARN. Keeping the original names is strictly less
work.

---

## Quick command reference

```bash
export AWS_PROFILE=jomo AWS_REGION=ap-south-1

# Cluster access
aws eks update-kubeconfig --region ap-south-1 --name 4-jomo-cluster

# App
kubectl get pods,svc,ingress,hpa -n staging
kubectl logs -n staging -l app=jomo-backend -f
kubectl rollout restart deployment/jomo-backend -n staging

# Monitoring
kubectl get pods,pvc -n monitoring-staging
kubectl port-forward -n monitoring-staging svc/grafana 3001:3000

# TLS
kubectl get certificate,challenges -n staging

# Load balancer hostname
kubectl get svc -n ingress-nginx ingress-nginx-controller

# Repo helper scripts
./scripts/quick-check.sh
npm run monitoring:check
```

## Tear-down (if you need to start over)

```bash
# Delete k8s LoadBalancers FIRST, or eksctl will fail to delete the VPC
helm uninstall ingress-nginx -n ingress-nginx
kubectl delete namespace staging monitoring-staging --ignore-not-found

eksctl delete cluster -f infra/cluster.yaml --wait
```

Then check the CloudFormation console for leftover `eksctl-4-jomo-cluster-*` stacks, and the EC2
console for orphaned Elastic IPs and volumes — those keep billing after a partial delete.
