/**
 * Single source of truth for the EXRAIL block canvas editor's language surface:
 * palette contents, node color/label, param shape, availability gating, and
 * the EXRAIL text emitted for each block. Extending the language (a new
 * stack/cap command) means adding one entry here.
 */

import type { BlockTypeDef, DefinedObjects } from './exrail-block-compiler'

export type { BlockShape, BlockParamDef, BlockTypeDef, DefinedObjects, CanvasNodeInfo, ParsedGraph, ParseResult } from './exrail-block-compiler'

const hasTurnouts = (d: DefinedObjects) => d.turnouts.length > 0
const hasSensors = (d: DefinedObjects) => (d.sensors ?? []).length > 0
const hasSignals = (d: DefinedObjects) => d.signals.length > 0
const hasRouteOrSequence = (d: DefinedObjects) => (d.routes?.length ?? 0) + (d.sequences?.length ?? 0) > 0

export const BLOCK_REGISTRY: BlockTypeDef[] = [
    {
        id: 'ROUTE',
        shape: 'hat',
        label: 'Route',
        color: '#2c3e50',
        params: [],
        isAvailable: () => true,
        emit: () => 'ROUTE',
    },
    {
        id: 'SEQUENCE',
        shape: 'hat',
        label: 'Sequence',
        color: '#2c3e50',
        params: [],
        isAvailable: () => true,
        emit: () => 'SEQUENCE',
    },
    {
        id: 'THROW',
        shape: 'stack',
        label: 'Throw turnout',
        color: '#e67e22',
        params: [{ name: 'turnoutId', label: 'Turnout', kind: 'turnoutRef' }],
        isAvailable: hasTurnouts,
        emit: (p) => `THROW(${p.turnoutId})`,
    },
    {
        id: 'CLOSE',
        shape: 'stack',
        label: 'Close turnout',
        color: '#e67e22',
        params: [{ name: 'turnoutId', label: 'Turnout', kind: 'turnoutRef' }],
        isAvailable: hasTurnouts,
        emit: (p) => `CLOSE(${p.turnoutId})`,
    },
    {
        id: 'RED',
        shape: 'stack',
        label: 'Signal red',
        color: '#c0392b',
        params: [{ name: 'signalId', label: 'Signal', kind: 'signalRef' }],
        isAvailable: hasSignals,
        emit: (p) => `RED(${p.signalId})`,
    },
    {
        id: 'AMBER',
        shape: 'stack',
        label: 'Signal amber',
        color: '#c0392b',
        params: [{ name: 'signalId', label: 'Signal', kind: 'signalRef' }],
        isAvailable: hasSignals,
        emit: (p) => `AMBER(${p.signalId})`,
    },
    {
        id: 'GREEN',
        shape: 'stack',
        label: 'Signal green',
        color: '#c0392b',
        params: [{ name: 'signalId', label: 'Signal', kind: 'signalRef' }],
        isAvailable: hasSignals,
        emit: (p) => `GREEN(${p.signalId})`,
    },
    {
        id: 'DELAY',
        shape: 'stack',
        label: 'Delay',
        color: '#7f8c8d',
        params: [{ name: 'ms', label: 'Milliseconds', kind: 'number' }],
        isAvailable: () => true,
        emit: (p) => `DELAY(${p.ms})`,
    },
    {
        id: 'IF',
        shape: 'branch',
        label: 'If sensor active',
        color: '#8e44ad',
        params: [{ name: 'sensorId', label: 'Sensor', kind: 'sensorRef' }],
        isAvailable: hasSensors,
        emit: (p) => `IF(${p.sensorId})`,
    },
    {
        id: 'IFNOT',
        shape: 'branch',
        label: 'If sensor inactive',
        color: '#8e44ad',
        params: [{ name: 'sensorId', label: 'Sensor', kind: 'sensorRef' }],
        isAvailable: hasSensors,
        emit: (p) => `IFNOT(${p.sensorId})`,
    },
    {
        id: 'IFCLOSED',
        shape: 'branch',
        label: 'If turnout closed',
        color: '#8e44ad',
        params: [{ name: 'turnoutId', label: 'Turnout', kind: 'turnoutRef' }],
        isAvailable: hasTurnouts,
        emit: (p) => `IFCLOSED(${p.turnoutId})`,
    },
    {
        id: 'IFTHROWN',
        shape: 'branch',
        label: 'If turnout thrown',
        color: '#8e44ad',
        params: [{ name: 'turnoutId', label: 'Turnout', kind: 'turnoutRef' }],
        isAvailable: hasTurnouts,
        emit: (p) => `IFTHROWN(${p.turnoutId})`,
    },
    {
        id: 'DONE',
        shape: 'cap',
        label: 'Done',
        color: '#34495e',
        params: [],
        isAvailable: () => true,
        emit: () => 'DONE',
    },
    {
        id: 'FOLLOW',
        shape: 'cap',
        label: 'Follow route/sequence',
        color: '#34495e',
        params: [{ name: 'target', label: 'Route/Sequence', kind: 'routeOrSequenceRef' }],
        isAvailable: hasRouteOrSequence,
        emit: (p) => `FOLLOW(${p.target})`,
    },
]
