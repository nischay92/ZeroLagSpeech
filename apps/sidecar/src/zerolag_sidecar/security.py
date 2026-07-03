from ipaddress import ip_address


def is_loopback_host(host: str | None, *, allow_test_client: bool = False) -> bool:
    if host is None:
        return False
    if allow_test_client and host == "testclient":
        return True
    if host == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False
