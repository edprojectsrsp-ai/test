import socket
import json

def fetch_api(path):
    s = socket.socket()
    s.settimeout(10)
    try:
        s.connect(('127.0.0.1', 8000))
        req = f'GET /api/v1{path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
        s.sendall(req.encode())
        data = b''
        while True:
            try:
                chunk = s.recv(4096)
            except socket.timeout:
                break
            if not chunk:
                break
            data += chunk
        
        # Parse HTTP response
        resp = data.decode('utf-8', errors='replace')
        parts = resp.split('\r\n\r\n', 1)
        if len(parts) > 1:
            body = parts[1]
            try:
                return json.loads(body)
            except:
                return body[:500]
        return resp[:500]
    except Exception as e:
        return {'error': repr(e)}
    finally:
        s.close()

# Test endpoints
print("Testing /api/v1/dashboard/summary:")
result = fetch_api('/dashboard/summary')
print(json.dumps(result, indent=2)[:1000])

print("\n\nTesting /api/v1/dashboard/scheme-cards:")
result = fetch_api('/dashboard/scheme-cards')
print(json.dumps(result, indent=2)[:1000])

print("\n\nTesting /api/v1/plant-amr/dashboard:")
result = fetch_api('/plant-amr/dashboard?financial_year=2026-27')
print(json.dumps(result, indent=2)[:1000])

print("\n\nTesting /api/v1/capex/fy-options:")
result = fetch_api('/capex/fy-options')
print(json.dumps(result, indent=2)[:1000])
