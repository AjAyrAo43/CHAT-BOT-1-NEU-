"""
app/utils/formatters.py
-----------------------
Shared formatting helpers used across routers.
"""
import datetime


def format_utc(dt) -> str:
    """Format a datetime as an ISO string with UTC timezone marker.
    This ensures JavaScript's new Date() correctly interprets it as UTC.
    """
    if dt is None:
        return ""
    if isinstance(dt, datetime.datetime):
        return dt.strftime("%Y-%m-%dT%H:%M:%S") + "+00:00"
    return str(dt)
