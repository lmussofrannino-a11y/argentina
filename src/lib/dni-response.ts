type DniMediaRecord = {
  foto?: string | null
  firma?: string | null
  fotoStorageKey?: string | null
  firmaStorageKey?: string | null
  [key: string]: unknown
}

export const dniPublicSelect = {
  id: true,
  userId: true,
  nombre: true,
  apellido: true,
  dniNumero: true,
  domicilio: true,
  nacimiento: true,
  fechaEmision: true,
  sexo: true,
  userId_value: true,
  tramiteNumero: true,
  ejemplar: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function withoutDniImages<T extends { dni: DniMediaRecord | null }>(user: T) {
  if (!user.dni) return user

  const { foto: _foto, firma: _firma, fotoStorageKey: _fotoStorageKey, firmaStorageKey: _firmaStorageKey, ...dni } = user.dni
  return { ...user, dni: { ...dni, foto: null, firma: null } }
}
