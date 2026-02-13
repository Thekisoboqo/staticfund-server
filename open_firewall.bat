@echo off
echo Opening port 5001 for StaticFund server...
netsh advfirewall firewall add rule name="StaticFund Server" dir=in action=allow protocol=TCP localport=5001
echo.
echo Done! Port 5001 is now open.
echo You can now connect from your phone.
pause
