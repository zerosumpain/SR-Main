# HA Entity Map — John's House

Last verified: 2026-07-28. Regenerate with `ha_render_template({ template: "{{ states | map(attribute='entity_id') | list | to_json }}" })` if stale.

## Security (Ring)

| Entity | Notes |
|--------|-------|
| `camera.front_door_live_view` | Ring doorbell cam |
| `camera.indoor_cam_live_view` | Indoor Ring cam |
| `camera.front_live_view` | Front Ring cam |
| `event.front_door_ding` | Doorbell press |
| `event.front_door_motion` | Doorbell motion |
| `event.indoor_cam_motion` | Indoor motion |
| `event.front_motion` | Front cam motion |
| `light.front_light` | Ring front light (on/off only) |
| `sensor.front_door_battery` | Ring doorbell battery |
| `sensor.indoor_cam_battery` | Indoor cam battery (plugged → always 100%) |
| `sensor.front_battery` | Front cam battery (unknown/plugged) |
| `siren.front_siren`, `siren.indoor_cam_siren` | Ring sirens |
| `switch.front_door_motion_detection` | Motion detect toggle |
| `switch.front_motion_detection` | Front cam motion toggle |
| `switch.indoor_cam_motion_detection` | Indoor cam motion toggle |

**No smart locks. No alarm panel.** Doors are manual.

## Heating / Tado

| Entity | Notes |
|--------|-------|
| `climate.downstairs_hallway` | Main thermostat — **unavailable** (restored, since 2026-07-25) |
| `sensor.downstairs_hallway_temperature` | Indoor temp — **unavailable** |
| `sensor.downstairs_hallway_humidity` | Indoor humidity — **unavailable** |
| `sensor.kelly_home_outdoor_temperature` | Outdoor temp — **unavailable** |
| `sensor.kelly_home_weather_condition` | Weather text — **unavailable** |
| `sensor.kelly_home_solar_percentage` | Solar % — **unavailable** |
| `sensor.kelly_home_tado_mode` | Tado mode (home/away/sleep) — **unavailable** |
| `sensor.kelly_home_geofencing_mode` | Geofencing mode — **unavailable** |
| `sensor.downstairs_hallway_tado_mode` | Tado mode (alt sensor) — **unavailable** |
| `binary_sensor.ru1253118976_connection_state` | Tado bridge 1 — **unavailable since 2026-07-25** |
| `binary_sensor.ib2976125952_connection_state` | Tado bridge 2 — **unavailable since 2026-07-25** |

**Both Tado bridges went offline simultaneously on 2026-07-25** and remained down through 2026-07-28. All downstream Tado entities (climate, sensors, weather, solar) show `unavailable` with `restored: true`. This is not N independent failures — it's one root cause (likely power/network to the Tado Internet Bridge). Check bridge connectivity before touching individual Tado sensors.

## Downstairs Hallway (Zigbee / Aqara sensor cluster)

| Entity | Notes |
|--------|-------|
| `binary_sensor.downstairs_hallway_window` | Window contact — **unavailable** |
| `binary_sensor.downstairs_hallway_power` | Power monitoring — **unavailable** |
| `binary_sensor.downstairs_hallway_early_start` | — **unavailable** |
| `binary_sensor.downstairs_hallway_overlay` | — **unavailable** |

All four go unavailable together — likely a single Zigbee/Aqara device hub. Treat as one failure, not four. Also went down on 2026-07-25.

## Network — Entity-Naming Quirk ⚠️

**The HA entity IDs are SWAPPED vs their friendly names.** The base entity IDs (`mesh_wi_fi_*`) actually carry Sky ADSL data, and the `_3` variants carry the actual mesh WiFi data. This is a long-standing integration labelling issue, not a live/backup split.

| Entity | friendly_name (actual) | Last seen state |
|--------|------------------------|-----------------|
| `binary_sensor.mesh_wi_fi_wan_status` | "Sky ADSL Router WAN status" | unavailable (as of 2026-07-28) |
| `binary_sensor.mesh_wi_fi_wan_status_3` | "Mesh Wi-Fi WAN status" | off (disconnected, 2026-07-28) |
| `binary_sensor.sky_adsl_router_wan_status` | "Mesh Wi-Fi WAN status" | off (disconnected, 2026-07-28) |
| `sensor.mesh_wi_fi_external_ip` | "Sky ADSL Router External IP" | unavailable |
| `sensor.mesh_wi_fi_external_ip_3` | "Mesh Wi-Fi External IP" | 0.0.0.0 |
| `sensor.mesh_wi_fi_download_speed` | "Sky ADSL Router Download speed" | unavailable |
| `sensor.mesh_wi_fi_download_speed_3` | "Mesh Wi-Fi Download speed" | 0.0 (since 2026-07-27) |
| `sensor.mesh_wi_fi_upload_speed_3` | "Mesh Wi-Fi Upload speed" | 0.0 (since 2026-07-27) |

**Both WAN connections appear offline in HA** as of 2026-07-28. The mesh WiFi reports `off` (disconnected), IP 0.0.0.0, speeds at 0. Given the internet is clearly working (John is chatting via jkai), these sensors are likely reporting stale integration data rather than a real outage.

**When investigating connectivity:** check both `_3` variants first — they carry the mesh WiFi data despite the confusing entity ID. Use `ha_render_template` with a filter sweep rather than guessing entity IDs:

```
{{ states | map(attribute='entity_id') | select('search','mesh|wifi|wan|internet') | list | sort | join('\n') }}
```

## People / Presence

| Entity | Notes |
|--------|-------|
| `person.john` | John |
| `person.katie` | Katie |
| `person.jemima` | Jemima |
| `person.rory` | Rory |
| `person.fintan` | Fintan |
| `device_tracker.life360_john_kelly` (etc.) | Life360 trackers per person |
| `device_tracker.life360_katie_kelly` | Katie's Life360 |
| `device_tracker.life360_jemima_kelly` | Jemima's Life360 |
| `device_tracker.life360_rory_kelly` | Rory's Life360 |
| `device_tracker.life360_fintan_kelly` | Fintan's Life360 |
| `device_tracker.johns_phone` | John's phone (native) |
| `device_tracker.johns_phone_2` | John's phone (secondary) |
| `binary_sensor.life360_online_johnkelly_main_gmail_com` | Life360 service online status |

**Note:** `ha_query_state` may 404 for person entities — use `ha_render_template({ template: "{{ states('person.john') }}" })` instead.

## Lights (Hue)

Key groups: `light.hallways`, `light.kids_rooms`, `light.kids_and_hall`, `light.master_bedroom`, `light.dining_room`, `light.kitchen`, `light.study`, `light.living_room`, `light.outside_study`.

Individual lights include: `light.lounge_ceiling`, `light.table_light`, `light.bottom_of_the_stairs`, `light.hue_play_1/2`, `light.hue_color_lamp_1/3/4`, `light.toilet_lamp`, `light.hallway_entrance`, `light.outside_light`, `light.first_light`, `light.hue_white_spot_1`–`6`, etc.

Several Hue lights went `unavailable` on 2026-07-25 and never re-reported — notably `light.lounge_ceiling`, `light.upstairs_outside_fb`, `light.upstairs_outside_mb`. The outside lights show state `on` with `brightness: 0`, indicating stale cached state from the HA restart.

## Dimmers / Button Batteries

| Entity | Typical range |
|--------|---------------|
| `sensor.kitchen_dimmer_battery` | CRITICAL when < 10% |
| `sensor.upstairs_hall_dimmer_battery` | Low at ~15% |
| `sensor.hue_smart_button_1_battery` | Often `unavailable` |
| `sensor.hue_smart_button_2_battery` | Often `unavailable` |

## Alexa / Echo Devices

Many media players (`media_player.living_room_tv`, `media_player.rorys_fire`, `media_player.bedroom_show`, `media_player.jemima_s_room`, `media_player.fins_echo`, `media_player.john_s_echo_studio`, `media_player.everywhere`, etc.) with corresponding connectivity sensors, DND switches, and next alarm/timer/reminder sensors.

Notable motion sensors:
- `binary_sensor.john_s_echo_motion` — John's Echo motion
- `binary_sensor.john_s_echo_dot_motion` — John's Echo Dot motion

## Automations

| Entity | Notes |
|--------|-------|
| `switch.automation_mimic_presence` | Presence mimic mode |
| `switch.automation_go_to_sleep` | Bedtime automation |
| `switch.automation_lights_off` | Lights off automation |
| `switch.automation_none` | No automation active |
| `switch.automation_dim_hallway_on_evening` | Evening hallway dim |

## Updates

| Entity | Notes |
|--------|-------|
| `update.hacs_update` | HACS (currently 2.0.5) |
| `update.life360_update` | Life360 integration |
| `update.alexa_media_player_update` | Alexa integration |
| `update.fordpass_update` | FordPass integration |

## Historical Outage: 2026-07-25 Mass Unavailable Event

On **2026-07-25 ~13:30 UTC**, a large number of entities across multiple integrations went `unavailable` simultaneously with `restored: true`:

- **Tado** — both bridges + all climate/sensors (still down as of 2026-07-28)
- **Hue** — some lights (lounge ceiling, upstairs outside FB/MB at 0 brightness)
- **Aqara** — downstairs hallway window/power/early_start/overlay sensors
- **WAN sensors** — Sky ADSL and mesh WiFi both stopped reporting

This pattern (multiple integrations, multiple domains, same timestamp) suggests an HA restart or core integration reload event rather than individual device failures. When investigating entity unavailability, always check `last_changed` timestamps — if they cluster around one date, look for an HA-level cause first.