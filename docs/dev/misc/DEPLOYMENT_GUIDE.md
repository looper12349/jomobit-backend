# JOMO Backend Deployment Guide - Multi-Environment

This guide covers the complete CI/CD setup for the JOMO Backend application with zero-downtime deployment through a bastion host, supporting both production and staging environments.

## Architecture Overview

```
GitHub Actions → Docker Hub → Bastion Host → Backend Server
```

- **Bastion Host**: `13.126.109.111` (Public IP)
- **Backend Server**: `10.0.2.227` (Private IP)
- **Production Port**: `3000`
- **Staging Port**: `3002`

## Branch Strategy

- **`main`** → Deploys to **Production** (Port 3000)
- **`feature/enhance-generation`** → Deploys to **Staging** (Port 3002)
- **`develop`** → Builds only (no deployment)
- **Pull Requests** → Builds and tests only

## Prerequisites

### 1. GitHub Secrets Configuration

Add the following secrets to your GitHub repository (`Settings > Secrets and variables > Actions`):

#### Infrastructure Secrets
```
BASTION_HOST=13.126.109.111
BASTION_USER=ubuntu
BASTION_SSH_KEY=<your-bastion-private-key>
BASTION_PORT=22

BACKEND_HOST=10.0.2.227
BACKEND_USER=ubuntu
```

#### Docker Hub Secrets
```
DOCKERHUB_USERNAME=ai29
DOCKERHUB_TOKEN=<your-dockerhub-token>
```

#### Application Environment Variables
```
# Server Configuration
FRONTEND_URL=https://jomo.dazzeldigital.com
LOG_LEVEL=info

# Database
MONGODB_URI=mongodb+srv://jomobitai:Ecox3DcIFhiDbwIz@jomobit.svtjsyk.mongodb.net/jomobit
REDIS_URL=redis://localhost:6379

# Auth0
AUTH0_DOMAIN=auth.jomo.dazzeldigital.com
AUTH0_AUDIENCE=https://hello-world.example.com
AUTH0_CLIENT_ID=32KGb77SDbXWiPKwaoOPOyHA6GywNV0r
AUTH0_CLIENT_SECRET=<your-auth0-client-secret>
AUTH0_WEBHOOK_SECRET=<your-auth0-webhook-secret>
AUTH0_ACTIONS_SECRET=<your-auth0-actions-secret>

# Razorpay (Production)
RAZORPAY_KEY_ID=rzp_live_Rbe99qL2NG4CWS
RAZORPAY_KEY_SECRET=<your-razorpay-secret>
RAZORPAY_WEBHOOK_SECRET=<your-razorpay-webhook-secret>

# AI Services
OPENAI_API_KEY=<your-openai-key>
GEMINI_API_KEY=<your-gemini-key>
IDEOGRAM_API_KEY=<your-ideogram-key>
FAL_KEY=<your-fal-key>

# ImageKit
IMAGEKIT_PUBLIC_KEY=<your-imagekit-public-key>
IMAGEKIT_PRIVATE_KEY=<your-imagekit-private-key>
IMAGEKIT_URL_ENDPOINT=<your-imagekit-endpoint>

# N8N
N8N_WEBHOOK_URL=<your-n8n-webhook-url>
N8N_JWT_SECRET=<your-n8n-jwt-secret>
N8N_REQUEST_KEY=<your-n8n-request-key>
N8N_GENERATION_FLOW_ID=<your-generation-flow-id>
N8N_ENHANCEMENT_FLOW_ID=<your-enhancement-flow-id>

# Optional
DEFAULT_USER_CREDITS=3
SUBSCRIPTION_RECONCILIATION_ENABLED=true
SLACK_WEBHOOK_URL=<your-slack-webhook>
```

### **Optional Staging Environment Secrets**
*These override production values for staging deployments. If not provided, production values are used.*

```
# Staging-specific overrides (optional)
STAGING_FRONTEND_URL=https://staging.jomo.dazzeldigital.com
STAGING_MONGODB_URI=<staging-mongodb-uri>
STAGING_REDIS_URL=<staging-redis-url>

# Staging Auth0 (optional - use test environment)
STAGING_AUTH0_DOMAIN=<staging-auth0-domain>
STAGING_AUTH0_CLIENT_ID=<staging-client-id>
STAGING_AUTH0_CLIENT_SECRET=<staging-client-secret>

# Staging Razorpay (optional - use test keys)
STAGING_RAZORPAY_KEY_ID=<staging-razorpay-key>
STAGING_RAZORPAY_KEY_SECRET=<staging-razorpay-secret>

# Staging AI Services (optional - separate quotas)
STAGING_OPENAI_API_KEY=<staging-openai-key>
STAGING_IDEOGRAM_API_KEY=<staging-ideogram-key>
STAGING_FAL_KEY=<staging-fal-key>

# Staging N8N (optional)
STAGING_N8N_WEBHOOK_URL=<staging-n8n-webhook>
STAGING_N8N_GENERATION_FLOW_ID=<staging-flow-id>
```

### 2. Server Setup

#### Bastion Host Setup
```bash
# Install Docker on bastion (if needed for debugging)
sudo apt update
sudo apt install -y docker.io
sudo usermod -aG docker ubuntu

# Ensure SSH key access to backend server
ssh-copy-id ubuntu@10.0.2.227
```

#### Backend Server Setup
```bash
# Install Docker
sudo apt update
sudo apt install -y docker.io curl
sudo usermod -aG docker ubuntu
sudo systemctl enable docker
sudo systemctl start docker

# Create application directory
mkdir -p /home/ubuntu/jomo-backend
cd /home/ubuntu/jomo-backend

# Test Docker installation
docker --version
docker run hello-world
```

## Deployment Workflows

### 1. Automatic Deployment (CI/CD)

#### Continuous Integration (`.github/workflows/ci.yml`)
- Triggers on push to `main` or `develop` branches
- Builds Docker image with security best practices
- Pushes to Docker Hub with multiple tags
- Uses build cache for faster builds

#### Continuous Deployment (`.github/workflows/cd.yml`)
- Triggers after successful CI build
- Implements zero-downtime blue-green deployment
- Performs health checks before switching traffic
- Automatic rollback on failure
- Cleans up old Docker images

### 2. Manual Deployment

#### Using GitHub Actions
1. Go to `Actions` tab in GitHub
2. Select `Continuous Deployment - JOMO Backend`
3. Click `Run workflow`
4. Choose environment and image tag (optional)

#### Using Deployment Script
```bash
# Deploy latest image to production
./scripts/deploy.sh production latest

# Deploy specific image tag
./scripts/deploy.sh production main-abc123

# Deploy to staging
./scripts/deploy.sh staging
```

## Zero-Downtime Deployment Process

1. **Image Pull**: Download new Docker image
2. **Blue Container**: Start new container on port 3001
3. **Health Check**: Verify new container is healthy
4. **Traffic Switch**: Stop old container, start new on port 3000
5. **Final Check**: Verify production health
6. **Cleanup**: Remove old Docker images

## Monitoring and Health Checks

### Health Check Endpoint
```bash
curl http://localhost:3000/health
```

Expected Response:
```json
{
  "status": "OK",
  "timestamp": "2026-01-31T19:44:27.504Z",
  "uptime": 26.555894262,
  "environment": "production"
}
```

### Container Status
```bash
# Check running containers
docker ps

# View container logs
docker logs jomo-backend

# Follow logs in real-time
docker logs -f jomo-backend
```

## Rollback Procedures

### Automatic Rollback
- Deployment automatically rolls back if health checks fail
- Previous container image is preserved for quick recovery

### Manual Rollback
```bash
# Via GitHub Actions
1. Go to Actions → Continuous Deployment
2. Run workflow with rollback option

# Via SSH (Emergency)
ssh ubuntu@13.126.109.111
ssh ubuntu@10.0.2.227

# Find previous image
docker images ai29/jomo-backend

# Stop current container
docker stop jomo-backend
docker rm jomo-backend

# Start previous version
docker run -d --name jomo-backend --restart unless-stopped -p 3000:3000 \
  -e NODE_ENV=production \
  [... other env vars ...] \
  ai29/jomo-backend:previous-tag
```

## Security Considerations

### 1. Secrets Management
- All sensitive data stored in GitHub Secrets
- No secrets in Docker images or code
- Environment variables passed at runtime

### 2. Container Security
- Non-root user in containers
- Minimal Alpine Linux base image
- Regular security updates
- Health checks for monitoring

### 3. Network Security
- Private backend server (no public IP)
- Access only through bastion host
- SSH key authentication
- Firewall rules (ensure port 3000 is open)

## Troubleshooting

### Common Issues

#### 1. SSH Connection Failed
```bash
# Test bastion connection
ssh -i ~/.ssh/your-key ubuntu@13.126.109.111

# Test backend connection through bastion
ssh -i ~/.ssh/your-key ubuntu@13.126.109.111 "ssh ubuntu@10.0.2.227 'echo Connected'"
```

#### 2. Docker Pull Failed
```bash
# Check Docker Hub credentials
docker login

# Manually pull image
docker pull ai29/jomo-backend:latest
```

#### 3. Health Check Failed
```bash
# Check container logs
docker logs jomo-backend

# Check if port is accessible
curl -v http://localhost:3000/health

# Check container status
docker ps -a
```

#### 4. Environment Variables Missing
```bash
# Check container environment
docker exec jomo-backend env | grep NODE_ENV

# Restart with correct environment
docker stop jomo-backend
docker rm jomo-backend
# Run with proper -e flags
```

### Log Analysis
```bash
# Application logs
docker logs jomo-backend

# System logs
sudo journalctl -u docker

# Check disk space
df -h
docker system df
```

## Performance Optimization

### 1. Docker Image Optimization
- Multi-stage builds
- Layer caching
- Minimal dependencies
- Regular cleanup

### 2. Deployment Speed
- Build cache in GitHub Actions
- Parallel health checks
- Optimized SSH connections
- Image layer reuse

### 3. Resource Management
```bash
# Monitor resource usage
docker stats jomo-backend

# Clean up unused resources
docker system prune -f

# Remove old images (automated in deployment)
docker image prune -f
```

## Maintenance

### Regular Tasks
1. **Weekly**: Review deployment logs
2. **Monthly**: Update base images
3. **Quarterly**: Security audit
4. **As needed**: Scale resources

### Backup Strategy
- Database backups (MongoDB Atlas handles this)
- Configuration backups (GitHub repository)
- Image registry (Docker Hub retention)

## Support

For deployment issues:
1. Check GitHub Actions logs
2. Review container logs
3. Verify network connectivity
4. Check resource availability
5. Contact DevOps team if needed

---

**Last Updated**: January 31, 2026
**Version**: 1.0.0