#!/bin/bash
set -ex
export DEBIAN_FRONTEND=noninteractive

# 1. Update and install system dependencies
apt-get update
apt-get install -y python3 python3-pip python3-venv unzip curl build-essential nginx

# 2. Install AWS CLI v2 via official installer if not present
if ! command -v aws &> /dev/null; then
  cd /tmp
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  unzip -q awscliv2.zip
  ./aws/install
  rm -rf awscliv2.zip ./aws
fi

# 3. Install Node.js 20.x
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# 4. Create app workspace
mkdir -p /opt/floodproof
cd /opt/floodproof

# 5. Download latest deployment archive from S3
aws s3 cp s3://floodproof-verification-artifacts-699158992887/releases/floodproof_release_final.zip /opt/floodproof/app.zip
unzip -o -q /opt/floodproof/app.zip -d /opt/floodproof/

# 6. Create Python Virtual Environment & Install all requirements reproducibly
python3 -m venv /opt/floodproof/venv
/opt/floodproof/venv/bin/pip install --upgrade pip setuptools wheel
/opt/floodproof/venv/bin/pip install -r /opt/floodproof/requirements.txt

# Ensure child_process execFile('python') uses this environment
ln -sf /opt/floodproof/venv/bin/python /usr/local/bin/python
ln -sf /opt/floodproof/venv/bin/python3 /usr/local/bin/python3
ln -sf /opt/floodproof/venv/bin/python /usr/bin/python

# 7. Install Node dependencies from package-lock and build production bundle
cd /opt/floodproof/web
npm ci || npm install
npm run build

# 8. Create systemd service for FloodProof Next.js production server
cat << 'EOF' > /etc/systemd/system/floodproof.service
[Unit]
Description=FloodProof Satellite Operator Workspace
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/floodproof/web
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=PATH=/opt/floodproof/venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable floodproof.service
systemctl restart floodproof.service

# 9. Configure Nginx Reverse Proxy with high upload limits and timeouts
cat << 'EOF' > /etc/nginx/sites-available/default
server {
    listen 80;
    server_name _;
    client_max_body_size 100M;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

nginx -t
systemctl restart nginx

echo "FloodProof deployment complete and verified!"
