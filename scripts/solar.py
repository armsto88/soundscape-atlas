"""Sunrise, sunset and time-of-day periods for recording segments.

Uses the NOAA solar calculator equations (accurate to about a minute between
latitudes +/-72 degrees), with no third-party dependencies.

Periods follow the sun, not the clock:
  dawn       the 2 hours centred on sunrise
  morning    end of dawn until solar noon
  afternoon  solar noon until the start of dusk
  dusk       the 2 hours centred on sunset
  night      the rest
Where the sun does not rise or set (polar day or night) there is no dawn or
dusk: the day is morning/afternoon either side of solar noon, or all night.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from math import acos, asin, cos, degrees, radians, sin, tan
from typing import Optional
from zoneinfo import ZoneInfo

SUNRISE_ZENITH = 90.833  # sun's centre 0.833 degrees below the horizon (refraction + disc radius)
DAWN_DUSK_HALF_WINDOW = timedelta(hours=1)
PERIODS = ("night", "dawn", "morning", "afternoon", "dusk")


@dataclass
class SunDay:
    """Solar events for one local date, as naive local datetimes."""

    sunrise: Optional[datetime]
    sunset: Optional[datetime]
    solar_noon: datetime
    always_up: bool = False
    always_down: bool = False


def _julian_day(day: date) -> float:
    """Julian day at 00:00 UTC of a calendar date."""
    return day.toordinal() + 1721424.5


def _sun(julian_day: float) -> tuple:
    """Solar declination (radians) and equation of time (minutes)."""
    t = (julian_day - 2451545.0) / 36525.0
    mean_long = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
    mean_anomaly = radians(357.52911 + t * (35999.05029 - 0.0001537 * t))
    eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    centre = (
        sin(mean_anomaly) * (1.914602 - t * (0.004817 + 0.000014 * t))
        + sin(2 * mean_anomaly) * (0.019993 - 0.000101 * t)
        + sin(3 * mean_anomaly) * 0.000289
    )
    omega = radians(125.04 - 1934.136 * t)
    apparent_long = radians(mean_long + centre - 0.00569 - 0.00478 * sin(omega))
    obliquity = radians(
        23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * cos(omega)
    )
    declination = asin(sin(obliquity) * sin(apparent_long))

    y = tan(obliquity / 2) ** 2
    l0 = radians(mean_long)
    equation_of_time = 4 * degrees(
        y * sin(2 * l0)
        - 2 * eccentricity * sin(mean_anomaly)
        + 4 * eccentricity * y * sin(mean_anomaly) * cos(2 * l0)
        - 0.5 * y * y * sin(4 * l0)
        - 1.25 * eccentricity * eccentricity * sin(2 * mean_anomaly)
    )
    return declination, equation_of_time


def _event_minutes(day: date, latitude: float, longitude: float, rising: bool) -> Optional[float]:
    """Minutes after 00:00 UTC of `day` for sunrise/sunset; None if it does not happen.

    May be negative or above 1440: events belong to the local date `day`,
    which is not the UTC date for sites far from Greenwich.
    """
    jd0 = _julian_day(day)
    minutes = 720 - 4 * longitude  # start from solar noon, then refine twice
    lat = radians(latitude)
    for _ in range(3):
        declination, eq_time = _sun(jd0 + minutes / 1440)
        cos_hour_angle = (cos(radians(SUNRISE_ZENITH)) - sin(lat) * sin(declination)) / (
            cos(lat) * cos(declination)
        )
        if cos_hour_angle > 1 or cos_hour_angle < -1:
            return None
        hour_angle = degrees(acos(cos_hour_angle))
        offset = hour_angle if rising else -hour_angle
        minutes = 720 - 4 * (longitude + offset) - eq_time
    return minutes


def _polar_state(day: date, latitude: float, longitude: float) -> str:
    jd = _julian_day(day) + (720 - 4 * longitude) / 1440
    declination, _ = _sun(jd)
    lat = radians(latitude)
    cos_hour_angle = (cos(radians(SUNRISE_ZENITH)) - sin(lat) * sin(declination)) / (cos(lat) * cos(declination))
    return "always_down" if cos_hour_angle > 1 else "always_up"


def _sun_for_utc_date(base: date, latitude: float, longitude: float, tz: ZoneInfo) -> SunDay:
    """Events around the solar noon that falls on UTC date `base`, in local time."""
    midnight_utc = datetime(base.year, base.month, base.day, tzinfo=timezone.utc)

    def to_local(minutes: float) -> datetime:
        return (midnight_utc + timedelta(minutes=minutes)).astimezone(tz).replace(tzinfo=None)

    _, eq_time = _sun(_julian_day(base) + (720 - 4 * longitude) / 1440)
    noon = to_local(720 - 4 * longitude - eq_time)

    rise = _event_minutes(base, latitude, longitude, rising=True)
    set_ = _event_minutes(base, latitude, longitude, rising=False)
    if rise is None or set_ is None:
        state = _polar_state(base, latitude, longitude)
        return SunDay(None, None, noon, always_up=state == "always_up", always_down=state == "always_down")
    return SunDay(to_local(rise), to_local(set_), noon)


def sun_day(day: date, latitude: float, longitude: float, tz: ZoneInfo) -> SunDay:
    """The sunrise, solar noon and sunset belonging to a local date.

    "Belonging" means the solar noon falls on that date. Sunset may then be
    after local midnight (high latitudes in summer), and for timezones far
    from solar time (e.g. Pacific/Tongatapu) the UTC date differs from the
    local one, so the neighbouring UTC dates are tried as well.
    """
    for shift in (0, -1, 1):
        candidate = _sun_for_utc_date(day + timedelta(days=shift), latitude, longitude, tz)
        if candidate.solar_noon.date() == day:
            return candidate
    return _sun_for_utc_date(day, latitude, longitude, tz)


def _in_window(moment: datetime, event: Optional[datetime]) -> bool:
    return event is not None and event - DAWN_DUSK_HALF_WINDOW <= moment < event + DAWN_DUSK_HALF_WINDOW


def period_at(moment: datetime, sun: SunDay, previous: Optional[SunDay] = None, following: Optional[SunDay] = None) -> str:
    """Time-of-day period for a naive local datetime on the SunDay's date.

    `previous`/`following` are the neighbouring days: a sunset after midnight
    belongs to the previous day, a sunrise just before midnight to the next.
    """
    if _in_window(moment, sun.sunrise) or (following is not None and _in_window(moment, following.sunrise)):
        return "dawn"
    if _in_window(moment, sun.sunset) or (previous is not None and _in_window(moment, previous.sunset)):
        return "dusk"
    if sun.always_down:
        return "night"
    if sun.always_up or sun.sunrise is None or sun.sunset is None:
        return "morning" if moment < sun.solar_noon else "afternoon"
    if sun.sunrise + DAWN_DUSK_HALF_WINDOW <= moment < sun.solar_noon:
        return "morning"
    if sun.solar_noon <= moment < sun.sunset - DAWN_DUSK_HALF_WINDOW:
        return "afternoon"
    return "night"


def segment_sun(start: datetime, end: datetime, latitude: float, longitude: float, tz: ZoneInfo) -> dict:
    """Period and that day's sunrise/sunset for a segment (naive local start/end).

    The period is taken at the segment's midpoint. `noon_offset_hours` (solar
    noon minus 12:00 on the local clock) is for sanity checks and is not
    published: more than about 3.5 hours almost always means a wrong timezone.
    """
    middle = start + (end - start) / 2 if end > start else start
    day = middle.date()
    sun = sun_day(day, latitude, longitude, tz)
    previous = sun_day(day - timedelta(days=1), latitude, longitude, tz)
    following = sun_day(day + timedelta(days=1), latitude, longitude, tz)
    clock_noon = datetime(day.year, day.month, day.day, 12)
    return {
        "period": period_at(middle, sun, previous, following),
        "sunrise": sun.sunrise.strftime("%H:%M") if sun.sunrise else "",
        "sunset": sun.sunset.strftime("%H:%M") if sun.sunset else "",
        "noon_offset_hours": (sun.solar_noon - clock_noon).total_seconds() / 3600,
    }
