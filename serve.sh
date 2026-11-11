#!/bin/sh
cd /home/kit/tokin
exec python3 -m http.server 43871 --bind 0.0.0.0 --directory dist
