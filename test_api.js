// const fetch = require('node-fetch'); // Using built-in fetch

async function test() {
    try {
        // 1. GET Devices
        console.log('Testing GET /api/devices...');
        const res = await fetch('http://localhost:5000/api/devices');
        if (!res.ok) throw new Error(`GET failed: ${res.status} ${res.statusText}`);
        const devices = await res.json();
        console.log('GET Success:', devices.length, 'devices found');

        if (devices.length > 0) {
            const id = devices[0].id;
            // 2. PUT Device
            console.log(`Testing PUT /api/devices/${id}...`);
            const updateRes = await fetch(`http://localhost:5000/api/devices/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Updated Device Name',
                    watts: 123,
                    image_url: ''
                })
            });
            if (!updateRes.ok) {
                const text = await updateRes.text();
                throw new Error(`PUT failed: ${updateRes.status} ${updateRes.statusText} - ${text}`);
            }
            const updated = await updateRes.json();
            console.log('PUT Success:', updated);
        }

        // 3. POST Device
        console.log('Testing POST /api/devices...');
        const createRes = await fetch('http://localhost:5000/api/devices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'New Test Device',
                watts: 500,
                image_url: ''
            })
        });
        if (!createRes.ok) throw new Error(`POST Device failed: ${createRes.status}`);
        const newDevice = await createRes.json();
        console.log('POST Device Success:', newDevice);

        // 4. POST Usage
        console.log('Testing POST /api/usage...');
        const usageRes = await fetch('http://localhost:5000/api/usage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                device_id: newDevice.id,
                hours_per_day: 5
            })
        });
        if (!usageRes.ok) throw new Error(`POST Usage failed: ${usageRes.status}`);
        const usageLog = await usageRes.json();
        console.log('POST Usage Success:', usageLog);

    } catch (err) {
        console.error('TEST FAILED:', err);
    }
}

test();
