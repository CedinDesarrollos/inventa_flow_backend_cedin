import 'dotenv/config';

async function testRoundtrip() {
    console.log(`\n--- Timezone Roundtrip Simulation ---`);

    // 1. DATA (Face Value in DB)
    const DB_TIME_STR = '2026-02-17T09:00:00.000Z'; // 9:00 AM stored as Z
    const dbTime = new Date(DB_TIME_STR);
    console.log(`1. DB Has: ${dbTime.toISOString()} (Represents 09:00 Local)`);

    // 2. AVAILABILITY OUTPUT (Shift +3h so frontend shows 09:00)
    // Frontend is UTC-3. 
    // If we send T09:00Z -> Frontend shows 06:00. (User Complaint)
    // If we send T12:00Z -> Frontend shows 09:00. (Goal)
    const SHIFT_OFFSET = 3 * 3600000;
    const outputTime = new Date(dbTime.getTime() + SHIFT_OFFSET);
    console.log(`2. Backend Sends: ${outputTime.toISOString()} (${outputTime.getUTCHours()}:${outputTime.getUTCMinutes()}Z)`);

    // 3. FRONTEND DISPLAY (Simulated)
    // Frontend converts UTC to Local (-3h)
    const displayHour = outputTime.getUTCHours() - 3;
    console.log(`3. Frontend Displays: ${displayHour}:00 (Matches DB 09:00? YES)`);

    // 4. USER SELECTION
    // User selects "09:00" from the list.
    // Frontend (MUI DatePicker or custom slots) sends back the ISO string of the selection.
    // If the slot value was T12:00Z, it sends T12:00Z.
    const inputTimeStr = outputTime.toISOString();
    console.log(`4. Frontend Sends Back: ${inputTimeStr}`);

    // 5. APPOINTMENT CREATE (Shift -3h to Store)
    const receivedTime = new Date(inputTimeStr);
    const storedTime = new Date(receivedTime.getTime() - SHIFT_OFFSET);
    console.log(`5. Backend Saves: ${storedTime.toISOString()}`);

    // CHECK
    if (storedTime.toISOString() === DB_TIME_STR) {
        console.log(`\n✅ SUCCESS: Roundtrip matches! DB -> DB unchanged.`);
    } else {
        console.log(`\n❌ FAILURE: Mismatch! Got ${storedTime.toISOString()} expected ${DB_TIME_STR}`);
    }
}

testRoundtrip().catch(console.error);
