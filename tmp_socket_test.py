import socket

def test_backend():
    s = socket.socket()
    s.settimeout(5)
    try:
        s.connect(('127.0.0.1', 8000))
        s.sendall(b'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
        data = b''
        while True:
            try:
                chunk = s.recv(4096)
            except socket.timeout:
                print('TIMEOUT')
                break
            if not chunk:
                break
            data += chunk
        print(data[:1000].decode('utf-8', errors='replace'))
    except Exception as e:
        print('ERROR', repr(e))
    finally:
        s.close()

if __name__ == '__main__':
    test_backend()
