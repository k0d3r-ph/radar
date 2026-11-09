# 1. Utiliza imagem oficial do Node.js baseada em Debian (slim)
FROM node:22-slim

# 2. Instala dependências do Chromium e o próprio Chromium (necessário para o whatsapp-web.js)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. Define variáveis de ambiente para pular o download interno do Puppeteer 
# e apontar para a instalação local do Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=5000

# 4. Configura o diretório de trabalho
WORKDIR /app

# 5. Copia e instala dependências
COPY package*.json ./
RUN npm ci

# 6. Copia o restante do código e compila o TypeScript
COPY . .
RUN npm run build

# 7. Expõe a porta de rede
EXPOSE 5000

# 8. Comando para iniciar o servidor
CMD ["npm", "start"]
