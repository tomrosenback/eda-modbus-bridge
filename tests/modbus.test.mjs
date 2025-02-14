import {
    parseTemperature,
    createModelNameString,
    parseAlarmTimestamp,
    getDeviceFamilyName,
    getAutomationAndHeatingTypeName,
    parseStateBitField,
} from '../app/modbus.mjs'

test('parse temperature', () => {
    // Positive, float
    expect(parseTemperature(171)).toEqual(17.1)
    // Negative, integer
    expect(parseTemperature(65486)).toEqual(-5)
})

test('create model name from device information', () => {
    // Heating, no cooling, DC fan
    expect(
        createModelNameString({
            familyType: 'Pingvin',
            fanType: 'EC',
            heatingTypeInstalled: 'EDE',
            coolingTypeInstalled: null,
        })
    ).toEqual('Pingvin eco EDE')

    // Heating, cooling, DC fan
    expect(
        createModelNameString({
            familyType: 'Pegasus',
            fanType: 'EC',
            heatingTypeInstalled: 'EDE',
            coolingTypeInstalled: 'CG',
        })
    ).toEqual('Pegasus eco EDE - CG')

    // No heating, no cooling, AC fan
    expect(
        createModelNameString({
            familyType: 'Pandion',
            fanType: 'AC',
            heatingTypeInstalled: null,
            coolingTypeInstalled: null,
        })
    ).toEqual('Pandion')
})

test('parse alarm timestamp', () => {
    const alarmResult = {
        data: [
            10, // type
            2, // state,
            22, // year
            1, // month
            21, // day
            13, // hour
            45, // minute
        ],
    }

    const timestamp = parseAlarmTimestamp(alarmResult)

    // The ventilation unit is assumed to be using the same timezone as the computer running this software,
    // i.e. the result from Modbus is in local time.
    expect(timestamp.toLocaleString('en-US')).toEqual('1/21/2022, 1:45:00 PM')
})

test('device family name', () => {
    expect(getDeviceFamilyName(0)).toEqual('Pingvin')
    expect(getDeviceFamilyName(999)).toEqual('unknown')
})

test('heating type name', () => {
    expect(getAutomationAndHeatingTypeName(0)).toEqual('ED/MD')
    expect(getAutomationAndHeatingTypeName(3)).toEqual('EDE/MDE')
    expect(getAutomationAndHeatingTypeName(4)).toEqual('unknown')
})

test('parse state bitfield', () => {
    // Nothing set
    expect(parseStateBitField(0)).toEqual({
        'normal': true,
        'maxCooling': false,
        'maxHeating': false,
        'emergencyStop': false,
        'stop': false,
        'away': false,
        'longAway': false,
        'temperatureBoost': false,
        'co2Boost': false,
        'humidityBoost': false,
        'manualBoost': false,
        'overPressure': false,
        'cookerHood': false,
        'centralVacuumCleaner': false,
        'heaterCooldown': false,
        'summerNightCooling': false,
        'defrosting': false,
    })

    // Typical situation 1 (away enabled)
    expect(parseStateBitField(16)).toEqual({
        'normal': false,
        'maxCooling': false,
        'maxHeating': false,
        'emergencyStop': false,
        'stop': false,
        'away': true,
        'longAway': false,
        'temperatureBoost': false,
        'co2Boost': false,
        'humidityBoost': false,
        'manualBoost': false,
        'overPressure': false,
        'cookerHood': false,
        'centralVacuumCleaner': false,
        'heaterCooldown': false,
        'summerNightCooling': false,
        'defrosting': false,
    })

    // Typical situation 2 (away enabled, summerNightCooling active)
    expect(parseStateBitField(16 + 16384)).toEqual({
        'normal': false,
        'maxCooling': false,
        'maxHeating': false,
        'emergencyStop': false,
        'stop': false,
        'away': true,
        'longAway': false,
        'temperatureBoost': false,
        'co2Boost': false,
        'humidityBoost': false,
        'manualBoost': false,
        'overPressure': false,
        'cookerHood': false,
        'centralVacuumCleaner': false,
        'heaterCooldown': false,
        'summerNightCooling': true,
        'defrosting': false,
    })

    // Arbitrary situation (every second bit flipped)
    expect(parseStateBitField(1 + 4 + 16 + 64 + 256 + 1024 + 4096 + 16384)).toEqual({
        'normal': false,
        'maxCooling': true,
        'maxHeating': false,
        'emergencyStop': true,
        'stop': false,
        'away': true,
        'longAway': false,
        'temperatureBoost': true,
        'co2Boost': false,
        'humidityBoost': true,
        'manualBoost': false,
        'overPressure': true,
        'cookerHood': false,
        'centralVacuumCleaner': true,
        'heaterCooldown': false,
        'summerNightCooling': true,
        'defrosting': false,
    })
})
