/*
 *
 *  myAutomation_sensors.h
 *
*/


JMRI_SENSOR(276, 16)                   // all sensors on RT_DCD_16 at {I2CMux_0,SubBus_4,0x20}
ONBUTTON(276) PRINT("Sensor 164") DONE
ONBUTTON(-276) PRINT("Sensor -164") DONE

SEQUENCE(991)
AUTOSTART
PRINT("Setting sensors")
PARSE("<S 172 172 0>")                 // SNS_PARK_1_ENTRY
PARSE("<S 190 190 0>")                 // SNS_MAIN_UP_THREE
PARSE("<S 206 206 0>")                 // SNS_PLATFORM_4_ENTRY
DONE





