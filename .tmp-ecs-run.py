import paramiko
import time
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

HOST = '8.160.177.143'
USER = 'root'
PASS = 'chenmu@888'

def run(cmd, desc=None, timeout=300):
    if desc:
        print(f'\n=== {desc} ===')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=30)
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True, timeout=timeout)

    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            data = stdout.channel.recv(4096).decode('utf-8', errors='replace')
            if data:
                print(data, end='')
        time.sleep(0.2)

    remaining = stdout.read().decode('utf-8', errors='replace')
    if remaining:
        print(remaining, end='')
    err = stderr.read().decode('utf-8', errors='replace')
    if err:
        print('STDERR:', err, file=sys.stderr)

    exit_code = stdout.channel.recv_exit_status()
    client.close()
    return exit_code

if __name__ == '__main__':
    cmd = """set -e
cd /opt/graduation-photo-selector
echo '=== Fixing FACE_DB_NAME ==='
sed -i 's/^FACE_DB_NAME=.*/FACE_DB_NAME=graduation_photo_selector/' .env
grep '^FACE_DB_NAME' .env

echo '=== Restarting container ==='
docker stop graduation-photo-selector
docker rm graduation-photo-selector
docker run -d \\
  --name graduation-photo-selector \\
  --restart unless-stopped \\
  -p 7860:7860 \\
  -v /var/lib/graduation-photo-selector:/var/lib/graduation-photo-selector \\
  --env-file /opt/graduation-photo-selector/.env \\
  graduation-photo-selector:latest

echo '=== Waiting for startup ==='
sleep 8
docker logs --tail 10 graduation-photo-selector

TOKEN=$(curl -s -X POST http://localhost:7860/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"admin0306"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

echo '=== Testing face cluster ==='
curl -s -o /tmp/face_cluster_response.json -w "HTTP Status: %{http_code}\n" \
  -X POST http://localhost:7860/api/admin/face/cluster \
  -H 'Content-Type: application/json' \
  -H "X-Admin-Token: $TOKEN" \
  -d '{"token":"admin0306"}'
cat /tmp/face_cluster_response.json | python3 -m json.tool
"""
    code = run(cmd, 'Fixing DB name and testing cluster')
    sys.exit(code)
