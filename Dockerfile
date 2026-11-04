# Production Dockerfile for FORTIVEX
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy source code and database assets
COPY . .

# Expose server port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Start server
CMD ["node", "server.js"]
