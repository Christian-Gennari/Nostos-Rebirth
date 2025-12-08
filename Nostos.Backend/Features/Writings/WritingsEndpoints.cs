using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Writings;

public static class WritingsEndpoints
{
  public static IEndpointRouteBuilder MapWritingsEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/writings");


    // GET: Fetch the entire file list (FLAT)
    group.MapGet("/", async (NostosDbContext db) =>
    {
      var items = await db.Writings
              .Select(w => new WritingDto(
                  w.Id,
                  w.Name,
                  w.Type.ToString(), // Convert Enum to String
                  w.ParentId,
                  w.UpdatedAt
              ))
              .ToListAsync();

      return Results.Ok(items);
    });

    // GET: Fetch a single document (with Content)
    group.MapGet("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var item = await db.Writings.FindAsync(id);
      if (item is null) return Results.NotFound();

      // We use ToContentDto() here to include the actual markdown text
      return Results.Ok(item.ToContentDto());
    });

    // POST: Create new Folder or Document
    group.MapPost("/", async (CreateWritingDto dto, NostosDbContext db) =>
    {
      // Parse string "Folder" -> Enum.Folder
      if (!Enum.TryParse<WritingType>(dto.Type, true, out var type))
      {
        return Results.BadRequest("Invalid type. Must be 'Folder' or 'Document'.");
      }

      var model = new WritingModel
      {
        Name = dto.Name,
        Type = type,
        ParentId = dto.ParentId
      };

      db.Writings.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/writings/{model.Id}", model.ToDto());
    });

    // PUT: Update Name or Content (Auto-save)
    group.MapPut("/{id}", async (Guid id, UpdateWritingDto dto, NostosDbContext db) =>
    {
      var item = await db.Writings.FindAsync(id);
      if (item is null) return Results.NotFound();

      item.Name = dto.Name;
      item.Content = dto.Content;
      item.UpdatedAt = DateTime.UtcNow;

      await db.SaveChangesAsync();

      return Results.Ok(item.ToContentDto());
    });

    // PUT: Move (Drag & Drop)
    group.MapPut("/{id}/move", async (Guid id, MoveWritingDto dto, NostosDbContext db) =>
    {
      var item = await db.Writings.FindAsync(id);
      if (item is null) return Results.NotFound();

      // Simple cycle detection (prevent moving folder into itself)
      if (dto.NewParentId == id)
        return Results.BadRequest("Cannot move a folder into itself.");

      item.ParentId = dto.NewParentId;
      item.UpdatedAt = DateTime.UtcNow;

      await db.SaveChangesAsync();

      return Results.Ok(item.ToDto());
    });

    // DELETE
    group.MapDelete("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var item = await db.Writings.FindAsync(id);
      if (item is null) return Results.NotFound();

      // Cascade delete is configured in DbContext, so this deletes all children too.
      db.Writings.Remove(item);
      await db.SaveChangesAsync();

      return Results.NoContent();
    });

    return routes;
  }
}
