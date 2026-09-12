# Production Dockerfile for GitLab Engineering Reliability Intelligence Platform Backend
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy backend application source code
COPY . .

# Ensure storage directory exists and has permissions for the node user
RUN mkdir -p /app/storage && chown -R node:node /app

# Run as non-root user for defense-in-depth security
USER node

# Expose backend HTTP port
EXPOSE 4000

# Health check verifying process liveness
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start the server
CMD ["node", "src/server.js"]
