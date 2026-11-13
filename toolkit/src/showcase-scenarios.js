// Host-owned demonstration text; parsing, linking and evaluation remain in Rust.
export const graphTypes = `model Types {
  type A;
  type B;
  type C;
  type D;
}`;
export const graphRelations = `model Relations {
  specialization AB A to B;
  specialization BC B to C;
  specialization CA C to A;
  specialization AD A to D;
  specialization ABagain A to B;
}`;
export const circulationCatalog = `library Catalog {
  copy dune "Dune";
  copy earthsea "A Wizard of Earthsea" edition 2;
  copy foundation "Foundation" edition 3;
  member ada;
  member grace;
}`;
export const circulationLoans = `library Circulation {
  loan first copy dune to ada;
  loan third copy foundation to grace;
}`;
export const duplicateLoans = `library Circulation {
  loan first copy dune to ada;
  loan duplicate copy dune to grace;
}`;

export const kermlScript = `from intersect_api import Model, Type, Specialization, model

print("Packages:", [m.name for m in Model.all()])
print("Types:", [t.name for t in Type.all()])
for edge in Specialization.all():
    print(edge.name, edge.specific.name, "->", edge.general.name)
assert model.validate() == []
print("Use the Rcore behavior dock to execute the checked allGenerals binding.")
`;
