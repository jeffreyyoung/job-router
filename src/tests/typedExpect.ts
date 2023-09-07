import { expect } from '@jest/globals';
import { DeepPartial } from './DeepPartial';



export function typedExpect<T>(value: T) {
    return {
        toMatchObject: (expected: DeepPartial<T>) => expect(value).toMatchObject(expected as any),
        toBe: (expected: T) => expect(value).toBe(expected as any),
    }
}