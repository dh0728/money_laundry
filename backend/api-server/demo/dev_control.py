"""Launch a loopback panel controlling the deployed dev API with an ADMIN session."""
import argparse
import getpass
import os
from pathlib import Path
from types import SimpleNamespace

from api_client import ApiError
from control_panel import Controls, Replay, catalog
import operator_session
from operator_session import AdminClient, cloudflare_headers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-url', default='https://dev.aiaml.co.kr')
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--port', type=int, default=8502)
    parser.add_argument('--cloudflare', action='store_true', help='Cloudflare 서비스 토큰을 숨김 입력')
    args = parser.parse_args()
    client = replay = None
    cf_headers = {}
    try:
        if not 1 <= args.port <= 65535:
            raise ValueError('포트는 1~65535 범위여야 합니다.')
        catalog(args.data_dir)
        if args.cloudflare:
            cf_headers = cloudflare_headers(
                getpass.getpass('Cloudflare Client ID (숨김): '),
                getpass.getpass('Cloudflare Client Secret (숨김): '))
        else:
            cf_headers = cloudflare_headers(os.environ.get('CF_ACCESS_CLIENT_ID', ''),
                                            os.environ.get('CF_ACCESS_CLIENT_SECRET', ''))
        username = input('ADMIN 아이디: ').strip()
        password = getpass.getpass('ADMIN 비밀번호 (숨김): ')
        client = AdminClient(args.api_url, username, password, cf_headers=cf_headers)
        username = password = None
        client.connect()
        clock = client.get('demo/clock')
        replay = Replay(Controls(args.api_url, client, allow_remote=True, cf_headers=cf_headers))
        operator_session.runtime = SimpleNamespace(
            base=client.base_url, root=str(Path(args.data_dir).resolve()), replay=replay)
        print(f'연결 서버: {client.base_url} / 업무 시각: {clock["businessAt"]}')
        print(f'조작패널: http://127.0.0.1:{args.port} (종료: 작업 완료 후 Ctrl+C)')
        from streamlit.web import bootstrap
        options = {
            'server.address': '127.0.0.1', 'server.port': args.port,
            'server.headless': True, 'browser.gatherUsageStats': False,
            'server.fileWatcherType': 'none',
        }
        bootstrap.load_config_options(options)
        bootstrap.run(str(Path(__file__).with_name('control_panel.py')), False, [], options)
        return 0
    except ApiError as error:
        print(f'시작 실패: {error}')
        return 1
    except (OSError, ValueError):
        # Never print exception bodies from network/launcher dependencies.
        print('시작 실패: 데이터 경로·포트·HTTPS 주소·ADMIN 계정과 서버 상태를 확인하세요.')
        return 1
    finally:
        if replay:
            replay.pause.set()
            replay.pool.shutdown(wait=True)
            replay.controls.cf_headers.clear()
        if client:
            client.close()
        cf_headers.clear()
        operator_session.runtime = None


if __name__ == '__main__':
    raise SystemExit(main())
