# ==========================================
# Stage 1: Build the Vite + React application
# ==========================================
FROM node:20-alpine AS build

# Set the working directory inside the container
WORKDIR /app

# Copy package files and install dependencies cleanly
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of your application code
COPY . .

# Build the app (Vite outputs to the 'dist' folder)
RUN npm run build

# ==========================================
# Stage 2: Serve the app with Nginx
# ==========================================
FROM nginx:alpine

# Copy the built static files from Vite's 'dist' folder to Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# If you use React Router, uncomment the line below to allow client-side routing
# RUN sed -i 's/index  index.html index.htm;/index  index.html index.htm;\n        try_files $uri $uri\/ \/index.html;/g' /etc/nginx/conf.d/default.conf

# Expose port 80 to the outside world
EXPOSE 80

# Start Nginx server
CMD ["nginx", "-g", "daemon off;"]