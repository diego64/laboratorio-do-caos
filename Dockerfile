FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm install
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1
EXPOSE 8080
CMD ["npm", "start"]
