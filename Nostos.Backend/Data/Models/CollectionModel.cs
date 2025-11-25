using System;

namespace Nostos.Backend.Data.Models;

public class CollectionModel
{
  public Guid Id { get; set; } = Guid.NewGuid();
  public string Name { get; set; } = string.Empty;
}
