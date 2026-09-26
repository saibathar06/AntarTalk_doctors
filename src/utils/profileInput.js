export const profileFields = [
  'firstName', 'lastName', 'dateOfBirth', 'phoneNumber', 'professionalCategory',
  'professionalStatus', 'licenseNumber', 'licenseAuthority', 'university', 'course',
  'specialization', 'expectedGraduationDate', 'enrollmentNumber', 'timezone', 'bio'
];
export function profileData(input) {
  return Object.fromEntries(profileFields.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}
