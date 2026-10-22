FROM node:22-alpine

WORKDIR /app

# Zero-dependency static server: site files + assets go in the image,
# original-resolution photos (all_pic/) are mounted at runtime.
COPY package.json ./
COPY scripts/serve.mjs ./scripts/
COPY index.html app.js photos.js styles.css ./
COPY assets/ ./assets/

EXPOSE 5173
VOLUME ["/app/all_pic"]

CMD ["node", "scripts/serve.mjs", "--host", "0.0.0.0", "--port", "5173"]
