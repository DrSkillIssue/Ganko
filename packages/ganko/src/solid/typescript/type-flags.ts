import ts from "typescript";

export const TS_ANY_OR_UNKNOWN = ts.TypeFlags.Any | ts.TypeFlags.Unknown;

export const TS_BOOLEAN_LIKE = ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral;

export const TS_NUMBER_LIKE = ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral;

export const TS_BIGINT_LIKE = ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral;

export const TS_STRING_LIKE =
  ts.TypeFlags.String |
  ts.TypeFlags.StringLiteral |
  ts.TypeFlags.TemplateLiteral;

export const TS_ES_SYMBOL_LIKE =
  ts.TypeFlags.ESSymbol |
  ts.TypeFlags.UniqueESSymbol;

export const TS_OBJECT_LIKE = ts.TypeFlags.Object;

export const TS_PRIMITIVE_FLAGS =
  TS_STRING_LIKE |
  TS_NUMBER_LIKE |
  TS_BIGINT_LIKE |
  TS_BOOLEAN_LIKE |
  TS_ES_SYMBOL_LIKE |
  ts.TypeFlags.Void |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Null |
  ts.TypeFlags.Never;

export const TS_AMBIGUOUS_FLAGS = TS_ANY_OR_UNKNOWN;

export const TS_POSSIBLY_FALSY_FLAGS =
  TS_STRING_LIKE |
  TS_NUMBER_LIKE |
  TS_BOOLEAN_LIKE |
  ts.TypeFlags.Void |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Null;
