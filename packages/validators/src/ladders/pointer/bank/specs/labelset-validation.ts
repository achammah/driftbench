import { validationCases } from '../families/labelset-validation';
import { row } from './types';
export const validationSpecs = validationCases.map((value) =>
  row(
    `set-validation-${value.key}`,
    2,
    `Reject malformed label set: ${value.key}`,
    `A valid labelled scan followed by one malformed set (${value.name}).`,
    'Retain the valid planted rule; refuse only the malformed set with its offending name.',
    `labelset:${value.cause}`,
    { component: 'labelset' },
  ),
);
