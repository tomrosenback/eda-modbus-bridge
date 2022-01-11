import {
    getReadings,
    getDeviceInformation,
    getSettings,
    setSetting,
    getFlagSummary,
    setFlag,
    createModelNameString
} from './modbus.mjs'

const TOPIC_PREFIX = 'eda'
const TOPIC_PREFIX_MODE = `${TOPIC_PREFIX}/mode`
const TOPIC_PREFIX_READINGS = `${TOPIC_PREFIX}/readings`
const TOPIC_PREFIX_SETTINGS = `${TOPIC_PREFIX}/settings`
const TOPIC_NAME_STATUS = `${TOPIC_PREFIX}/status`

export const publishValues = async (modbusClient, mqttClient) => {
    // Create a map from topic name to value that should be published
    let topicMap = {
        [TOPIC_NAME_STATUS]: 'online',
    }

    // Publish state for each mode.
    const modeSummary = await getFlagSummary(modbusClient)

    for (const [mode, state] of Object.entries(modeSummary)) {
        const topicName = `${TOPIC_PREFIX_MODE}/${mode}`

        // Boolean values are changed to "ON" and "OFF" respectively since those are the
        // defaults for MQTT switches in Home Assistant
        topicMap[topicName] = state ? 'ON' : 'OFF'
    }

    // Publish each reading
    const readings = await getReadings(modbusClient)

    for (const [reading, value] of Object.entries(readings)) {
        const topicName = `${TOPIC_PREFIX_READINGS}/${reading}`
        topicMap[topicName] = JSON.stringify(value)
    }

    // Publish each setting
    const settings = await getSettings(modbusClient)

    for (const [setting, value] of Object.entries(settings)) {
        const topicName = `${TOPIC_PREFIX_SETTINGS}/${setting}`
        topicMap[topicName] = JSON.stringify(value)
    }

    const publishPromises = []

    for (const [topic, value] of Object.entries(topicMap)) {
        publishPromises.push(mqttClient.publish(topic, value))
    }

    await Promise.all(publishPromises)
}

export const subscribeToChanges = async (modbusClient, mqttClient) => {
    // Subscribe to settings and mode changes
    const topicNames = [
        `${TOPIC_PREFIX_MODE}/+/set`,
        `${TOPIC_PREFIX_SETTINGS}/+/set`,
    ]

    for (const topicName of topicNames) {
        console.log(`Subscribing to topic(s) ${topicName}`)

        await mqttClient.subscribe(topicName)
    }
}

export const handleMessage = async (modbusClient, mqttClient, topicName, payload) => {
    // Payload looks like a string when logged, but any comparison with === will equal false unless we convert the
    // Buffer to a string
    const payloadString = payload.toString()

    console.log(`Received ${payloadString} on topic ${topicName}`)

    // Handle settings updates
    if (topicName.startsWith(TOPIC_PREFIX_SETTINGS) && topicName.endsWith('/set')) {
        const settingName = topicName.substring(TOPIC_PREFIX_SETTINGS.length + 1, topicName.lastIndexOf('/'))

        console.log(`Updating setting ${settingName} to ${payloadString}`)

        await setSetting(modbusClient, settingName, payloadString)
    } else if (topicName.startsWith(TOPIC_PREFIX_MODE) && topicName.endsWith('/set')) {
        const mode = topicName.substring(TOPIC_PREFIX_MODE.length + 1, topicName.lastIndexOf('/'))

        console.log(`Updating mode ${mode} to ${payloadString}`)

        await setFlag(modbusClient, mode, payloadString === 'ON')
    }

    // Publish all values again for state changes to "take"
    await publishValues(modbusClient, mqttClient)
}

export const configureMqttDiscovery = async (modbusClient, mqttClient) => {
    // Build information about the ventilation unit. The "deviceIdentifier" is used as <node_id> in discovery topic
    // names, so it must match [a-zA-Z0-9_-].
    const modbusDeviceInformation = await getDeviceInformation(modbusClient)
    const softwareVersion = modbusDeviceInformation.softwareVersion
    const modelName = createModelNameString(modbusDeviceInformation)
    const deviceIdentifier = `enervent-${modbusDeviceInformation.familyType}-${modbusDeviceInformation.fanType}`.toLowerCase()

    // The "device" object that is part of each sensor's configuration payload
    const mqttDeviceInformation = {
        'identifiers': deviceIdentifier,
        'name': `Enervent ${modelName}`,
        'sw_version': softwareVersion,
        'model': modelName,
        'manufacturer': 'Enervent',
    }

    const configurationBase = {
        'platform': 'mqtt',
        'availability_topic': TOPIC_NAME_STATUS,
        'device': mqttDeviceInformation,
    }

    // Sensor configuration
    const sensorConfigurationMap = {
        // Temperature sensors
        'freshAirTemperature': createTemperatureSensorConfiguration(configurationBase, 'freshAirTemperature', 'Outside temperature',),
        'supplyAirTemperature': createTemperatureSensorConfiguration(configurationBase, 'supplyAirTemperature', 'Supply air temperature'),
        'supplyAirTemperatureAfterHeatRecovery': createTemperatureSensorConfiguration(configurationBase, 'supplyAirTemperatureAfterHeatRecovery', 'Supply air temperature (after heat recovery)'),
        'exhaustAirTemperature': createTemperatureSensorConfiguration(configurationBase, 'exhaustAirTemperature', 'Exhaust air temperature'),
        'wasteAirTemperature': createTemperatureSensorConfiguration(configurationBase, 'wasteAirTemperature', 'Waste air temperature'),
        // Humidity sensors
        'exhaustAirHumidity': createHumiditySensorConfiguration(configurationBase, 'exhaustAirHumidity', 'Exhaust air humidity'),
        'mean48HourExhaustHumidity': createHumiditySensorConfiguration(configurationBase, 'mean48HourExhaustHumidity', 'Exhaust air humidity (48h mean)'),
        // Generic sensors (percentages, minutes left, cascade values)
        'heatRecoverySupplySide': createSensorConfiguration(configurationBase, 'heatRecoverySupplySide', 'Heat recovery (supply)', {'unit_of_measurement': '%'}),
        'heatRecoveryExhaustSide': createSensorConfiguration(configurationBase, 'heatRecoveryExhaustSide', 'Heat recovery (exhaust)', {'unit_of_measurement': '%'}),
        'cascadeSp': createSensorConfiguration(configurationBase, 'cascadeSp', 'Cascade setpoint'),
        'cascadeP': createSensorConfiguration(configurationBase, 'cascadeP', 'Cascade P-value'),
        'cascadeI': createSensorConfiguration(configurationBase, 'cascadeI', 'Cascade I-value'),
        'overPressureTimeLeft': createSensorConfiguration(configurationBase, 'overPressureTimeLeft', 'Overpressure time left', {'unit_of_measurement': 'minutes'}),
        'ventilationLevelTarget': createSensorConfiguration(configurationBase, 'ventilationLevelTarget', 'Ventilation level (target)', {'unit_of_measurement': '%'}),
        'ventilationLevelActual': createSensorConfiguration(configurationBase, 'ventilationLevelActual', 'Ventilation level (actual)', {'unit_of_measurement': '%'}),
    }

    // Configurable numbers
    const numberConfigurationMap = {
        'overPressureDelay': createNumberConfiguration(configurationBase, 'overPressureDelay', 'Overpressure delay', {
            'min': 1,
            'max': 60,
            'unit_of_measurement': 'minutes',
        }),
        'awayVentilationLevel': createNumberConfiguration(configurationBase, 'awayVentilationLevel', 'Away ventilation level', {
            'min': 1,
            'max': 100,
            'unit_of_measurement': '%',
        }),
        'awayTemperatureReduction': createNumberConfiguration(configurationBase, 'awayTemperatureReduction', 'Away temperature reduction', {
            'min': 0,
            'max': 20,
            'unit_of_measurement': '°C',
        }),
        'longAwayVentilationLevel': createNumberConfiguration(configurationBase, 'longAwayVentilationLevel', 'Long away ventilation level', {
            'min': 1,
            'max': 100,
            'unit_of_measurement': '%',
        }),
        'longAwayTemperatureReduction': createNumberConfiguration(configurationBase, 'longAwayTemperatureReduction', 'Long away temperature reduction', {
            'min': 0,
            'max': 20,
            'unit_of_measurement': '°C',
        }),
        'temperatureTarget': createNumberConfiguration(configurationBase, 'temperatureTarget', 'Temperature target', {
            'min': 0,
            'max': 30,
            'unit_of_measurement': '°C',
        })
    }

    // Configurable switches
    const switchConfigurationMap = {
        'away': createSwitchConfiguration(configurationBase, 'away', 'Away'),
        'longAway': createSwitchConfiguration(configurationBase, 'longAway', 'Long away'),
        'overPressure': createSwitchConfiguration(configurationBase, 'overPressure', 'Overpressure'),
        'maxHeating': createSwitchConfiguration(configurationBase, 'maxHeating', 'Max heating'),
        'maxCooling': createSwitchConfiguration(configurationBase, 'maxCooling', 'Max cooling'),
        'manualBoost': createSwitchConfiguration(configurationBase, 'manualBoost', 'Manual boost'),
        'summerNightCooling': createSwitchConfiguration(configurationBase, 'summerNightCooling', 'Summer night cooling'),
    }

    // Final map that describes everything we want to be auto-discovered
    const configurationMap = {
        'sensor': sensorConfigurationMap,
        'number': numberConfigurationMap,
        'switch': switchConfigurationMap,
    }

    // Publish configurations
    for (const [entityType, entityConfigurationMap] of Object.entries(configurationMap)) {
        for (const [entityName, configuration] of Object.entries(entityConfigurationMap)) {
            const configurationTopicName = `homeassistant/${entityType}/${deviceIdentifier}/${entityName}/config`

            console.log(`Publishing Home Assistant auto-discovery configuration for ${entityType} "${entityName}"...`)
            await mqttClient.publish(configurationTopicName, JSON.stringify(configuration))
        }
    }
}

const createTemperatureSensorConfiguration = (configurationBase, readingName, entityName) => {
    return createSensorConfiguration(configurationBase, readingName, entityName, {
        'device_class': 'temperature',
        'unit_of_measurement': '°C',
    })
}

const createHumiditySensorConfiguration = (configurationBase, readingName, entityName) => {
    return createSensorConfiguration(configurationBase, readingName, entityName, {
        'device_class': 'humidity',
        'unit_of_measurement': '%H',
    })
}

const createSensorConfiguration = (configurationBase, readingName, entityName, extraProperties) => {
    if (!extraProperties) {
        extraProperties = {}
    }

    return {
        ...configurationBase,
        'state_class': 'measurement',
        'name': entityName,
        'object_id': `eda_${readingName}`,
        'state_topic': `${TOPIC_PREFIX_READINGS}/${readingName}`,
        'unique_id': `eda-${readingName}`,
        ...extraProperties,
    };
}

const createNumberConfiguration = (configurationBase, settingName, entityName, extraProperties) => {
    if (!extraProperties) {
        extraProperties = {}
    }

    return {
        ...configurationBase,
        'command_topic': `${TOPIC_PREFIX_SETTINGS}/${settingName}/set`,
        'state_topic': `${TOPIC_PREFIX_SETTINGS}/${settingName}`,
        'unique_id': `eda-${settingName}`,
        'entity_category': 'config',
        'name': entityName,
        'object_id': `eda_${settingName}`,
        ...extraProperties,
    }
}

const createSwitchConfiguration = (configurationBase, modeName, entityName) => {
    return {
        ...configurationBase,
        'unique_id': `eda-${modeName}`,
        'name': entityName,
        'object_id': `eda_${modeName}`,
        'icon': 'mdi:fan',
        'state_topic': `${TOPIC_PREFIX_MODE}/${modeName}`,
        'command_topic': `${TOPIC_PREFIX_MODE}/${modeName}/set`,
    }
}
