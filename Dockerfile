FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt

COPY . .

EXPOSE 8000 8001

CMD ["npm", "run", "dev"]
