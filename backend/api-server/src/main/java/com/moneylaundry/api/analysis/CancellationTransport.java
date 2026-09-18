package com.moneylaundry.api.analysis;
import java.nio.file.*;
import java.io.IOException;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.core.sync.RequestBody;
import tools.jackson.databind.ObjectMapper;
/** Immutable v2 cancellation messages. Acknowledgements are checked against every identity field. */
@Component
public class CancellationTransport implements AnalysisRunService.CancelTransport  {
  private final S3Client client;
  private final ObjectMapper mapper;
  private final String bucket,prefix;
  private final Path directory;
  public CancellationTransport(S3Client client,ObjectMapper mapper,@Value("${app.s3.bucket}") String bucket,@Value("${app.s3.prefix}") String prefix,@Value("${app.storage-dir}") String directory) {
    this.client=client;
    this.mapper=mapper;
    this.bucket=bucket;
    this.prefix=prefix.isEmpty()||prefix.endsWith("/")?prefix:prefix+"/";
    this.directory=Path.of(directory).toAbsolutePath().normalize().resolve("analysis-transport");
  }
  private String key(String payload,boolean output)  {
    var d=mapper.readTree(payload);
    return (output?"results/":"requests/")+d.get("job_id").asLong()+"/"+d.get("model_kind").asString()+"/"+UUID.fromString(d.get("request_id").asString())+"/rounds/"+d.get("execution_round").asInt()+"/"+(output?"cancel_ack.json":"cancel.json");
  }
  private byte[] read(String key)  {
    if(bucket.isBlank())  {
      try {
        return Files.readAllBytes(directory.resolve(key));
      }
      catch(NoSuchFileException e) {
        return null;
      }
      catch(IOException e) {
        throw new IllegalStateException("CANCEL_READ_FAILED");
      }
    }
    try {
      return client.getObjectAsBytes(b->b.bucket(bucket).key(prefix+key)).asByteArray();
    }
    catch(S3Exception e) {
      if(e.statusCode()==404)return null;
      throw e;
    }
  }
  @Override public void publish(UUID cancel,String payload)  {
    var document=mapper.readTree(payload);
    if(!cancel.toString().equals(document.get("cancel_id").asString())||document.get("contract_version").asInt()!=2)throw new IllegalArgumentException("CANCEL_IDENTITY_MISMATCH");
    String key=key(payload,false);
    byte[] bytes=payload.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    if(bucket.isBlank())  {
      Path path=directory.resolve(key).normalize();
      if(!path.startsWith(directory))throw new IllegalArgumentException("INVALID_CANCEL_PATH");
      Path temporary=null;
      try {
        Files.createDirectories(path.getParent());
        temporary=Files.createTempFile(path.getParent(),"cancel-",".tmp");
        Files.write(temporary,bytes);
        try {
          Files.createLink(path,temporary);
        }
        catch(FileAlreadyExistsException e) {
          same(key,document);
        }
      }
      catch(IOException e) {
        throw new IllegalStateException("CANCEL_WRITE_FAILED");
      }
      finally {
        if(temporary!=null)try {
          Files.deleteIfExists(temporary);
        }
        catch(IOException e) {
          throw new IllegalStateException("CANCEL_TEMP_CLEANUP_FAILED");
        }
      }
    }
    else {
      try {
        client.putObject(PutObjectRequest.builder().bucket(bucket).key(prefix+key).ifNoneMatch("*").contentType("application/json").build(),RequestBody.fromBytes(bytes));
      }
      catch(S3Exception e) {
        if(e.statusCode()!=412)throw e;
        same(key,document);
      }
    }
  }
  private void same(String key,tools.jackson.databind.JsonNode document) {
    byte[] existing=read(key);
    if(existing==null||!mapper.readTree(existing).equals(document))throw new IllegalStateException("CANCEL_IMMUTABLE_CONFLICT");
  }
  @Override public String acknowledgement(UUID cancel,String payload)  {
    byte[] bytes=read(key(payload,true));
    if(bytes==null)return null;
    var actual=mapper.readTree(bytes);
    var expected=mapper.readTree(payload);
    for(String field:List.of("contract_version","job_id","model_kind","request_id","execution_round","run_id","cancel_id"))if(!Objects.equals(actual.get(field),expected.get(field)))throw new IllegalStateException("CANCEL_ACK_IDENTITY_MISMATCH");
    if(!cancel.toString().equals(actual.get("cancel_id").asString()))throw new IllegalStateException("CANCEL_ACK_IDENTITY_MISMATCH");
    String status=actual.path("status").asString();
    if(!List.of("STOPPED","ALREADY_FINISHED").contains(status))throw new IllegalStateException("CANCEL_ACK_INVALID_STATUS");
    return status;
  }
}
